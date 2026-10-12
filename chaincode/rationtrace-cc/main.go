package main

// RationTrace Chaincode
// Implements the full stock-tracking + discrepancy-detection smart contract
// for the RationTrace project (Review 2).
//
// Sections:
//   1. Data structures
//   2. Stage functions        (Allocate, Dispatch, Receive, Sell, Reject, Return, Close)
//   3. Beneficiary functions   (SellToBeneficiary, FileComplaint, CheckMyEntitlement)
//   4. Query functions         (GetBatchHistory, GetAllDiscrepancies, GetComplaints)
//   5. Internal helpers        (identity capture, read/save, timestamps)

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-chaincode-go/pkg/cid"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// ------------------------------------------------------------------
// 1. DATA STRUCTURES
// ------------------------------------------------------------------

// StockRecord represents one batch of ration stock as it moves through
// Allocation -> Dispatch -> Receipt -> Sale/Return -> Closure.
type StockRecord struct {
	BatchID             string   `json:"batchID"`
	Commodity           string   `json:"commodity"`
	ManufacturerName    string   `json:"manufacturerName"`
	ManufacturingPlace  string   `json:"manufacturingPlace"`
	AllocatedQty        float64  `json:"allocatedQty"`
	DispatchedQty       float64  `json:"dispatchedQty"`
	DispatcherName      string   `json:"dispatcherName"` // captured from caller's blockchain identity
	DispatchPlace       string   `json:"dispatchPlace"`
	ReceivedQty         float64  `json:"receivedQty"`
	ReceiverName        string   `json:"receiverName"` // captured from caller's blockchain identity
	SoldQty             float64  `json:"soldQty"`
	ReturnedQty         float64  `json:"returnedQty"`
	Status              string   `json:"status"` // ALLOCATED, DISPATCHED, RECEIVED, SELLING, CLOSED, REJECTED
	CurrentHolder       string   `json:"currentHolder"`
	SourceWarehouse     string   `json:"sourceWarehouse"`
	DestinationShop     string   `json:"destinationShop"`
	CreatedAt           string   `json:"createdAt"`
	LastUpdatedAt       string   `json:"lastUpdatedAt"`
	DiscrepancyFlag     bool     `json:"discrepancyFlag"`
	DiscrepancySeverity string   `json:"discrepancySeverity"`
	DiscrepancyLog      []string `json:"discrepancyLog"`
	AuditTrail          []string `json:"auditTrail"`
}

// Beneficiary represents one citizen's entitlement record against one batch.
type Beneficiary struct {
	BeneficiaryID     string  `json:"beneficiaryID"`
	BatchID           string  `json:"batchID"`
	EntitledQty       float64 `json:"entitledQty"`
	ActualQtyReceived float64 `json:"actualQtyReceived"`
	ShopName          string  `json:"shopName"`
	TransactionDate   string  `json:"transactionDate"`
	ComplaintFlag     bool    `json:"complaintFlag"`
	ComplaintReason   string  `json:"complaintReason"`
}

// toleranceFraction allows small natural spillage (transport/handling) before
// something is flagged as a discrepancy. 2% is a simple, defensible default.
// const toleranceFraction = 0.02

// const beneficiaryKeyPrefix = "BENEFICIARY_"
const toleranceFraction = 0.02

const (
	severityNone     = "NONE"
	severityWarning  = "WARNING"
	severityCritical = "CRITICAL"
)

const beneficiaryKeyPrefix = "BENEFICIARY_"

// SmartContract is the RationTrace chaincode.
type SmartContract struct {
	contractapi.Contract
}

// ------------------------------------------------------------------
// 2. STAGE FUNCTIONS
// ------------------------------------------------------------------

// AllocateBatch creates a new batch when the government allocates stock.
func (s *SmartContract) AllocateBatch(ctx contractapi.TransactionContextInterface,
	batchID string, commodity string, manufacturerName string, manufacturingPlace string,
	allocatedQty float64) error {
	if err := validatePositiveQuantity(allocatedQty, "allocatedQty"); err != nil {
		return err
	}
	exists, err := s.batchExists(ctx, batchID)
	if err != nil {
		return err
	}
	if exists {
		return fmt.Errorf("batch %s already exists", batchID)
	}

	caller, err := getCallerIdentity(ctx)
	if err != nil {
		return err
	}
	now, err := s.txTimestamp(ctx)
	if err != nil {
		return err
	}

	record := StockRecord{
		BatchID:             batchID,
		Commodity:           commodity,
		ManufacturerName:    manufacturerName,
		ManufacturingPlace:  manufacturingPlace,
		AllocatedQty:        allocatedQty,
		Status:              "ALLOCATED",
		CurrentHolder:       caller,
		CreatedAt:           now,
		LastUpdatedAt:       now,
		DiscrepancyFlag:     false,
		DiscrepancySeverity: severityNone,
		DiscrepancyLog:      []string{},
		AuditTrail:          []string{fmt.Sprintf("[%s] ALLOCATED %.2f units by %s", now, allocatedQty, caller)},
	}

	return s.saveRecord(ctx, record)
}

// DispatchBatch is called by the warehouse when it sends stock towards a ration shop.
func (s *SmartContract) DispatchBatch(ctx contractapi.TransactionContextInterface,
	batchID string, dispatchedQty float64, sourceWarehouse string, destinationShop string) error {
	if err := validatePositiveQuantity(dispatchedQty, "dispatchedQty"); err != nil {
		return err
	}
	record, err := s.readRecord(ctx, batchID)
	if err != nil {
		return err
	}
	if record.Status != "ALLOCATED" {
		return fmt.Errorf("batch %s is not in ALLOCATED state (current: %s)", batchID, record.Status)
	}

	caller, err := getCallerIdentity(ctx)
	if err != nil {
		return err
	}
	now, err := s.txTimestamp(ctx)
	if err != nil {
		return err
	}

	// --- Discrepancy check: can't dispatch more than was allocated ---
	if dispatchedQty > record.AllocatedQty {
		record.DiscrepancyFlag = true
		record.DiscrepancySeverity = severityCritical
		record.DiscrepancyLog = append(record.DiscrepancyLog,
			fmt.Sprintf("[%s] CRITICAL: Dispatched %.2f exceeds allocated %.2f",
				now, dispatchedQty, record.AllocatedQty))
		return fmt.Errorf("dispatched quantity %.2f exceeds allocated quantity %.2f",
			dispatchedQty, record.AllocatedQty)
	}

	record.DispatchedQty = dispatchedQty
	record.DispatcherName = caller
	record.SourceWarehouse = sourceWarehouse
	record.DestinationShop = destinationShop
	record.Status = "DISPATCHED"
	record.CurrentHolder = caller
	record.LastUpdatedAt = now
	record.AuditTrail = append(record.AuditTrail,
		fmt.Sprintf("[%s] DISPATCHED %.2f units by %s to %s", now, dispatchedQty, caller, destinationShop))

	return s.saveRecord(ctx, record)
}

// ReceiveBatch is called by the ration shop when it confirms receipt.
func (s *SmartContract) ReceiveBatch(ctx contractapi.TransactionContextInterface,
	batchID string, receivedQty float64) error {
	if err := validatePositiveQuantity(receivedQty, "receivedQty"); err != nil {
		return err
	}
	record, err := s.readRecord(ctx, batchID)
	if err != nil {
		return err
	}
	if record.Status != "DISPATCHED" {
		return fmt.Errorf("batch %s is not in DISPATCHED state (current: %s)", batchID, record.Status)
	}

	caller, err := getCallerIdentity(ctx)
	if err != nil {
		return err
	}
	now, err := s.txTimestamp(ctx)
	if err != nil {
		return err
	}

	// --- Discrepancy check: dispatched vs received, within tolerance ---
	tolerance := record.DispatchedQty * toleranceFraction
	diff := record.DispatchedQty - receivedQty
	if diff > tolerance {
		record.DiscrepancyFlag = true
		record.DiscrepancySeverity = severityCritical
		record.DiscrepancyLog = append(record.DiscrepancyLog,
			fmt.Sprintf("[%s] CRITICAL: Dispatched %.2f but only %.2f received - %.2f unaccounted",
				now, record.DispatchedQty, receivedQty, diff))
	} else if diff > 0 {
		record.DiscrepancySeverity = severityWarning
	}

	record.ReceivedQty = receivedQty
	record.ReceiverName = caller
	record.Status = "RECEIVED"
	record.CurrentHolder = caller
	record.LastUpdatedAt = now
	record.AuditTrail = append(record.AuditTrail,
		fmt.Sprintf("[%s] RECEIVED %.2f units by %s", now, receivedQty, caller))

	return s.saveRecord(ctx, record)
}

// RejectBatch lets a ration shop refuse a batch outright (e.g. visibly damaged).
func (s *SmartContract) RejectBatch(ctx contractapi.TransactionContextInterface,
	batchID string, reason string) error {

	record, err := s.readRecord(ctx, batchID)
	if err != nil {
		return err
	}
	now, err := s.txTimestamp(ctx)
	if err != nil {
		return err
	}

	record.Status = "REJECTED"
	record.DiscrepancyFlag = true
	record.DiscrepancySeverity = severityCritical
	record.DiscrepancyLog = append(record.DiscrepancyLog, fmt.Sprintf("[%s] REJECTED - %s", now, reason))
	record.AuditTrail = append(record.AuditTrail, fmt.Sprintf("[%s] REJECTED - reason: %s", now, reason))
	record.LastUpdatedAt = now

	return s.saveRecord(ctx, record)
}

// ReturnStock records leftover/expired/damaged stock being sent back.
func (s *SmartContract) ReturnStock(ctx contractapi.TransactionContextInterface,
	batchID string, qty float64) error {
	if err := validatePositiveQuantity(qty, "qty"); err != nil {
		return err
	}
	record, err := s.readRecord(ctx, batchID)
	if err != nil {
		return err
	}
	now, err := s.txTimestamp(ctx)
	if err != nil {
		return err
	}

	availableQty := record.ReceivedQty - record.SoldQty - record.ReturnedQty

	if qty > availableQty {
		return fmt.Errorf(
			"return quantity %.2f exceeds available stock %.2f",
			qty, availableQty,
		)
	}

	record.ReturnedQty += qty
	record.AuditTrail = append(record.AuditTrail, fmt.Sprintf("[%s] RETURNED %.2f units", now, qty))
	record.LastUpdatedAt = now

	return s.saveRecord(ctx, record)
}

// CloseBatch runs the final reconciliation: received should equal sold + returned.
func (s *SmartContract) CloseBatch(ctx contractapi.TransactionContextInterface, batchID string) error {
	record, err := s.readRecord(ctx, batchID)
	if err != nil {
		return err
	}
	now, err := s.txTimestamp(ctx)
	if err != nil {
		return err
	}

	accounted := record.SoldQty + record.ReturnedQty
	tolerance := record.ReceivedQty * toleranceFraction
	diff := record.ReceivedQty - accounted
	if diff > tolerance || diff < -tolerance {
		record.DiscrepancyFlag = true
		record.DiscrepancySeverity = severityCritical
		record.DiscrepancyLog = append(record.DiscrepancyLog,
			fmt.Sprintf("[%s] CRITICAL: CLOSURE CHECK FAILED - received %.2f, sold+returned %.2f, diff %.2f",
				now, record.ReceivedQty, accounted, diff))
	} else if diff != 0 {
		record.DiscrepancySeverity = severityWarning
	}

	record.Status = "CLOSED"
	record.LastUpdatedAt = now
	record.AuditTrail = append(record.AuditTrail, fmt.Sprintf("[%s] CLOSED", now))

	return s.saveRecord(ctx, record)
}

// ------------------------------------------------------------------
// 3. BENEFICIARY FUNCTIONS
// ------------------------------------------------------------------

// SellToBeneficiary records a sale both on the batch and as a beneficiary entitlement record.
func (s *SmartContract) SellToBeneficiary(ctx contractapi.TransactionContextInterface,
	batchID string, beneficiaryID string, entitledQty float64, actualQtyReceived float64, shopName string) error {
	if err := validatePositiveQuantity(actualQtyReceived, "actualQtyReceived"); err != nil {
		return err
	}
	if err := validatePositiveQuantity(entitledQty, "entitledQty"); err != nil {
		return err
	}
	record, err := s.readRecord(ctx, batchID)
	if err != nil {
		return err
	}
	if record.Status != "RECEIVED" && record.Status != "SELLING" {
		return fmt.Errorf("batch %s is not available for sale (current status: %s)", batchID, record.Status)
	}
	now, err := s.txTimestamp(ctx)
	if err != nil {
		return err
	}

	// --- Discrepancy check: cumulative sold can't exceed received ---
	newSoldQty := record.SoldQty + actualQtyReceived
	if newSoldQty > record.ReceivedQty {
		record.DiscrepancyFlag = true
		record.DiscrepancySeverity = severityCritical
		record.DiscrepancyLog = append(record.DiscrepancyLog,
			fmt.Sprintf("[%s] CRITICAL: Cumulative sold %.2f exceeds received %.2f",
				now, newSoldQty, record.ReceivedQty))
	}

	record.SoldQty = newSoldQty
	record.Status = "SELLING"
	record.LastUpdatedAt = now
	record.AuditTrail = append(record.AuditTrail,
		fmt.Sprintf("[%s] SOLD %.2f units to beneficiary %s", now, actualQtyReceived, beneficiaryID))

	if err := s.saveRecord(ctx, record); err != nil {
		return err
	}

	beneficiary := Beneficiary{
		BeneficiaryID:     beneficiaryID,
		BatchID:           batchID,
		EntitledQty:       entitledQty,
		ActualQtyReceived: actualQtyReceived,
		ShopName:          shopName,
		TransactionDate:   now,
		ComplaintFlag:     false,
	}
	beneficiaryJSON, err := json.Marshal(beneficiary)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(beneficiaryKey(beneficiaryID, batchID), beneficiaryJSON)
}

// CheckMyEntitlement lets a beneficiary see entitled vs. actually-recorded quantity.
func (s *SmartContract) CheckMyEntitlement(ctx contractapi.TransactionContextInterface,
	beneficiaryID string, batchID string) (*Beneficiary, error) {

	data, err := ctx.GetStub().GetState(beneficiaryKey(beneficiaryID, batchID))
	if err != nil {
		return nil, fmt.Errorf("failed to read beneficiary record: %v", err)
	}
	if data == nil {
		return nil, fmt.Errorf("no record found for beneficiary %s and batch %s", beneficiaryID, batchID)
	}
	var beneficiary Beneficiary
	if err := json.Unmarshal(data, &beneficiary); err != nil {
		return nil, err
	}
	return &beneficiary, nil
}

// FileComplaint lets a beneficiary dispute a short quantity. It cross-references
// the complaint into the batch's own discrepancy log so it's visible to auditors
// alongside any upstream mismatch already detected for the same batch.
func (s *SmartContract) FileComplaint(ctx contractapi.TransactionContextInterface,
	beneficiaryID string, batchID string, reason string) error {

	key := beneficiaryKey(beneficiaryID, batchID)
	data, err := ctx.GetStub().GetState(key)
	if err != nil {
		return fmt.Errorf("failed to read beneficiary record: %v", err)
	}
	if data == nil {
		return fmt.Errorf("no record found for beneficiary %s and batch %s", beneficiaryID, batchID)
	}

	var beneficiary Beneficiary
	if err := json.Unmarshal(data, &beneficiary); err != nil {
		return err
	}
	beneficiary.ComplaintFlag = true
	beneficiary.ComplaintReason = reason

	updated, err := json.Marshal(beneficiary)
	if err != nil {
		return err
	}
	if err := ctx.GetStub().PutState(key, updated); err != nil {
		return err
	}

	// Cross-reference into the batch record itself.
	record, err := s.readRecord(ctx, batchID)
	if err != nil {
		return err
	}
	now, err := s.txTimestamp(ctx)
	if err != nil {
		return err
	}
	record.DiscrepancyFlag = true
	if record.DiscrepancySeverity == severityNone {
		record.DiscrepancySeverity = severityWarning
	}
	record.DiscrepancyLog = append(record.DiscrepancyLog,
		fmt.Sprintf("[%s] BENEFICIARY COMPLAINT from %s: %s", now, beneficiaryID, reason))
	record.LastUpdatedAt = now

	return s.saveRecord(ctx, record)
}

// ------------------------------------------------------------------
// 4. QUERY FUNCTIONS (read-only)
// ------------------------------------------------------------------

// GetBatchHistory returns the full record for one batch, including its audit trail.
func (s *SmartContract) GetBatchHistory(ctx contractapi.TransactionContextInterface, batchID string) (*StockRecord, error) {
	record, err := s.readRecord(ctx, batchID)
	if err != nil {
		return nil, err
	}
	return &record, nil
}

// GetAllDiscrepancies returns every batch currently flagged with a discrepancy.
func (s *SmartContract) GetAllDiscrepancies(ctx contractapi.TransactionContextInterface) ([]*StockRecord, error) {
	iterator, err := ctx.GetStub().GetStateByRange("", "")
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	var flagged []*StockRecord
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		if isBeneficiaryKey(item.Key) {
			continue
		}
		var record StockRecord
		if err := json.Unmarshal(item.Value, &record); err != nil {
			continue
		}
		if record.DiscrepancyFlag {
			flagged = append(flagged, &record)
		}
	}
	return flagged, nil
}

// GetComplaints returns every beneficiary record with an open complaint.
func (s *SmartContract) GetComplaints(ctx contractapi.TransactionContextInterface) ([]*Beneficiary, error) {
	iterator, err := ctx.GetStub().GetStateByRange("", "")
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	var complaints []*Beneficiary
	for iterator.HasNext() {
		item, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		if !isBeneficiaryKey(item.Key) {
			continue
		}
		var beneficiary Beneficiary
		if err := json.Unmarshal(item.Value, &beneficiary); err != nil {
			continue
		}
		if beneficiary.ComplaintFlag {
			complaints = append(complaints, &beneficiary)
		}
	}
	return complaints, nil
}

// ------------------------------------------------------------------
// 5. INTERNAL HELPERS
// ------------------------------------------------------------------

// getCallerIdentity cryptographically identifies who submitted this transaction,
// using Fabric's built-in client identity (MSP + certificate-derived ID) rather
// than trusting a manually typed name.
func getCallerIdentity(ctx contractapi.TransactionContextInterface) (string, error) {
	mspID, err := cid.GetMSPID(ctx.GetStub())
	if err != nil {
		return "", fmt.Errorf("failed to get MSP ID: %v", err)
	}
	clientID, err := cid.GetID(ctx.GetStub())
	if err != nil {
		return "", fmt.Errorf("failed to get client ID: %v", err)
	}
	return fmt.Sprintf("%s::%s", mspID, clientID), nil
}
func validatePositiveQuantity(qty float64, fieldName string) error {
	if qty <= 0 {
		return fmt.Errorf("%s must be greater than zero", fieldName)
	}
	return nil
}
func (s *SmartContract) batchExists(ctx contractapi.TransactionContextInterface, batchID string) (bool, error) {
	data, err := ctx.GetStub().GetState(batchID)
	if err != nil {
		return false, fmt.Errorf("failed to read from world state: %v", err)
	}
	return data != nil, nil
}

func (s *SmartContract) readRecord(ctx contractapi.TransactionContextInterface, batchID string) (StockRecord, error) {
	data, err := ctx.GetStub().GetState(batchID)
	if err != nil {
		return StockRecord{}, fmt.Errorf("failed to read batch %s: %v", batchID, err)
	}
	if data == nil {
		return StockRecord{}, fmt.Errorf("batch %s does not exist", batchID)
	}
	var record StockRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return StockRecord{}, err
	}
	return record, nil
}

func (s *SmartContract) saveRecord(ctx contractapi.TransactionContextInterface, record StockRecord) error {
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(record.BatchID, data)
}

// txTimestamp returns the transaction's ledger timestamp as an RFC3339 string.
// Using the ledger's own timestamp (not the client's local clock) keeps every
// node in agreement on when an event happened.
func (s *SmartContract) txTimestamp(ctx contractapi.TransactionContextInterface) (string, error) {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return "", err
	}
	return time.Unix(ts.Seconds, int64(ts.Nanos)).UTC().Format(time.RFC3339), nil
}

func beneficiaryKey(beneficiaryID string, batchID string) string {
	return beneficiaryKeyPrefix + beneficiaryID + "_" + batchID
}

func isBeneficiaryKey(key string) bool {
	return len(key) >= len(beneficiaryKeyPrefix) && key[:len(beneficiaryKeyPrefix)] == beneficiaryKeyPrefix
}

// ------------------------------------------------------------------
// MAIN
// ------------------------------------------------------------------

func main() {
	chaincode, err := contractapi.NewChaincode(&SmartContract{})
	if err != nil {
		fmt.Printf("Error creating rationtrace chaincode: %v\n", err)
		return
	}
	if err := chaincode.Start(); err != nil {
		fmt.Printf("Error starting rationtrace chaincode: %v\n", err)
	}
}
