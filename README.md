RationTrace
Blockchain-Based Public Distribution System (PDS) Tracking and Discrepancy Detection
RationTrace is a prototype for tracking ration batches through allocation, dispatch, receipt at a fair price shop, and beneficiary distribution. It uses a permissioned Hyperledger Fabric network to record operational transactions and provides a QR-linked public batch-tracking page.
Project Repository
GitHub: https://github.com/Team-Ration-Trace/RationTrace
Features
- Role-based interfaces for government allocation, warehouse dispatch, ration-shop receipt and beneficiary sale.
- Batch-level tracking across distribution stages.
- Quantity reconciliation to flag differences between recorded stages.
- Beneficiary entitlement lookup and complaint submission.
- Auditor views for batch history, discrepancies and complaints.
- QR-code generation for public batch tracking.
- Public tracking page backed by selected tracking data stored in Supabase.
Technologies Used
- Frontend: React, Vite, JavaScript
- Backend: Node.js, Express.js
- Blockchain: Hyperledger Fabric permissioned network
- Smart contract / chaincode: Go
- Public tracking data: Supabase
- Container/network tooling: Docker, Fabric samples and test-network
Repository Structure
Ration-trace/
├── backend/                 # Node.js/Express API
├── chaincode/
│   └── rationtrace-cc/      # Go chaincode
├── dataset/                 # Dataset and test-data utilities
├── frontend/                # React/Vite user interface
├── install-fabric.sh        # Fabric setup helper (inspect before running)
└── README.md
Prerequisites
Install the following tools before running the project:
- Git
- Node.js and npm
- Go
- Docker Engine / Docker Desktop with Linux containers
- Hyperledger Fabric binaries and samples compatible with the project
- A Supabase project for the public tracking feature
The commands below are based on the development setup used for this project. Exact package and Fabric versions should be checked against the project files and local environment.
1. Clone the Repository
git clone https://github.com/Team-Ration-Trace/RationTrace.git
cd RationTrace
If you already have the project cloned, open that folder instead of cloning it again.
2. Configure Environment Variables Safely
Check the backend and frontend for their required environment-variable names before creating local environment files.
- Backend configuration is read from the backend environment.
- The public tracking page uses the Supabase project URL and a public/anon key.
- Never commit service-role keys, passwords, private keys, certificates, or other secrets to GitHub.
- Keep local .env files out of version control. Use .env.example files containing placeholder values when documenting required settings.
For the backend, configure the Supabase URL and secret key using the variable names expected by backend/src/server.js. For the frontend, configure the Supabase URL and public anon key using the variable names expected by the frontend source. Do not paste secret values into this README.
3. Prepare Hyperledger Fabric
The project was developed with the Fabric test network and the rationchannel channel. The chaincode is named rationtrace.
If Fabric samples and binaries are not already installed, follow the official Hyperledger Fabric installation instructions and inspect install-fabric.sh before executing it.
Open a terminal in the Fabric test-network directory. In the development environment used for this project, it was located at:
cd ~/rationtrace-project/fabric-samples/test-network
Check the network status:
docker ps
If the peers and orderer are already running, do not reset or recreate the network. If setting up a fresh environment, follow the Fabric test-network instructions and deploy the project's chaincode using the source path and settings that match the checked-out repository. Do not blindly redeploy over an existing working network.
The channel and chaincode configuration used by the running project is:
- Channel: rationchannel
- Chaincode name: rationtrace
- Chaincode language: Go
- Network: Hyperledger Fabric permissioned test network
Hyperledger Fabric chaincode does not use a public Ethereum-style contract address. Document the channel, chaincode name, version, and deployment/commit details instead.
4. Install Backend Dependencies and Start the API
Open a terminal:
cd ~/rationtrace-project/backend
npm install
node src/server.js
Keep this terminal open. The local backend is expected to listen on port 3000.
If your repository was cloned to a different location, replace ~/rationtrace-project/backend with the actual backend directory. Confirm that the Fabric network is running and backend environment variables are configured before starting the server.
5. Install Frontend Dependencies and Start the UI
Open another terminal:
cd ~/rationtrace-project/frontend
npm install
npm run dev
Open the Vite address shown in the terminal. In the development setup used for this project, it was:
http://localhost:5173
The local frontend API configuration used during development was:
const BASE_URL = 'http://localhost:3000/api';
This URL is suitable for a frontend running on the same laptop as the local backend. It will not connect to your laptop's backend when the frontend is opened from a different device or from a deployed website.
6. Test the Main Workflow
1. Start the Fabric network and confirm the peers and orderer are running.
2. Start the backend API.
3. Start the frontend.
4. Open http://localhost:5173 on the development laptop and sign in with the locally configured demo accounts.
5. Test batch allocation, dispatch, shop receipt, beneficiary sale, entitlement lookup, complaint submission, and auditor views as applicable.
6. Generate a QR code for a batch and open its tracking URL.
7. Verify that quantities and statuses shown on the tracking page match the intended test data.
Use the actual demo credentials configured by the project. Do not publish real passwords in this README.
7. Public QR Tracking
The public tracking page is hosted separately from the local development frontend. An example tracking URL used during testing is:
https://rationtrace-frontend-ky3m.onrender.com/track/BATCH101
Replace BATCH101 with the batch ID to be viewed. The public page reads selected tracking data from Supabase. New transactions made on the local Fabric network appear on the public page only when the backend successfully synchronizes the relevant information to Supabase.
The local backend address http://localhost:3000 is only reachable from the same computer unless it is deliberately exposed through a suitable deployment or secure tunnel. Do not assume that a deployed frontend can call a visitor's local backend.
Main Functions
The application includes workflows for:
- Allocating a ration batch
- Dispatching a batch from a warehouse
- Confirming receipt at a ration shop
- Recording a beneficiary sale
- Checking beneficiary entitlement
- Filing beneficiary complaints
- Looking up a batch and its transaction history
- Reviewing recorded discrepancies and complaints
- Generating QR codes and displaying public batch tracking
Function names and API routes may differ from these user-facing workflow descriptions; refer to the current chaincode and backend source code for exact function names.
Dataset and Test Data
The dataset/ directory contains dataset-related utilities and test data. Use the files included in the repository and follow their instructions. If synthetic records are used for testing, identify them as synthetic in the report. Do not include personal beneficiary data or confidential operational records in a public repository.
Troubleshooting
- Backend cannot connect to Fabric: Confirm Docker containers are running, the correct Fabric test-network is selected, and the channel/chaincode have been deployed.
- Chaincode reports that a batch or beneficiary record does not exist: Verify that the exact batch and beneficiary IDs have been initialized or recorded in the ledger before querying them.
- Frontend cannot call the backend: Confirm the backend is running on port 3000 and the frontend API base URL is correct.
- QR page opens but data is missing or outdated: Verify that the batch exists in Supabase and that the backend synchronization succeeded.
- Port already in use: Stop the process using the port or configure a different port consistently in the relevant application settings.
Dependencies
Install the Node.js dependencies from each application's package file:
cd backend
npm install

cd ../frontend
npm install
Go dependencies for chaincode are defined in the chaincode module's go.mod file. Fabric binaries, samples, and Docker requirements must also be installed for the chosen environment.
Security Notes
- Do not commit .env files containing secrets.
- Do not publish Supabase service-role keys, private keys, TLS certificates, passwords, or real beneficiary information.
- Use placeholder values in any example configuration files.
- Review the files included in the ZIP before sharing it.
Reproducibility Note
RationTrace is a project prototype developed and tested in a local Hyperledger Fabric environment. Successful execution requires compatible dependencies, valid local environment configuration, and a correctly configured Fabric network. Public tracking additionally requires valid Supabase configuration and successful synchronization of the relevant batch data.
