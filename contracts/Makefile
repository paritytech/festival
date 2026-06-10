-include .env
-include ../.github/env

.PHONY: install build test test-revive deploy-festival deploy-substrate deploy-multicall copy-abis clean

install :
	forge install foundry-rs/forge-std
	forge install OpenZeppelin/openzeppelin-contracts

build :
	forge build

test :
	forge test -vv

deploy-festival : build
	forge script script/Deploy.s.sol:DeployFestival \
		--rpc-url $(RPC_URL) \
		--broadcast -vvvv

# Deploy via Substrate signer (pallet-revive). Requires DEPLOYER_SEED in .env.
deploy-substrate : build
	cd .. && npx tsx scripts/deploy/deploy-festival.ts

# Deploy Multicall3 via pallet-revive. Requires DEPLOYER_SEED in .env.
deploy-multicall : build
	cd .. && npx tsx scripts/deploy/deploy-multicall.ts

# Smoke-test a deployed Multicall3 against revive's ETH-RPC.
# Required: VITE_MULTICALL_ADDRESS (committed in .github/env, or set in contracts/.env, or passed inline).
# Optional: ETH_RPC_URL (defaults to Polkadot Hub TestNet ETH-RPC).
test-revive :
	@if [ -z "$(VITE_MULTICALL_ADDRESS)" ]; then \
		echo "VITE_MULTICALL_ADDRESS not set."; \
		echo "  Add to contracts/.env, or pass as a make argument:"; \
		echo "    make test-revive VITE_MULTICALL_ADDRESS=0x..."; \
		echo "  (env-prefix form 'VITE_...=0x... make ...' is silently overridden by .env — don't use it.)"; \
		exit 1; \
	fi
	cd .. && VITE_MULTICALL_ADDRESS=$(VITE_MULTICALL_ADDRESS) ETH_RPC_URL=$(ETH_RPC_URL) npx tsx scripts/e2e/test-multicall.ts

# Copy ABIs from Foundry output to shared package for frontend consumption
copy-abis : build
	@mkdir -p ../packages/shared/contracts/abis
	@for name in Festival FestivalSession AttendancePOAP NonTransferableERC721 Multicall3; do \
		if [ -f out/$$name.sol/$$name.json ]; then \
			cp out/$$name.sol/$$name.json ../packages/shared/contracts/abis/$$name.json; \
			echo "Copied $$name.json"; \
		else \
			echo "Warning: out/$$name.sol/$$name.json not found"; \
		fi; \
	done

clean :
	forge clean
