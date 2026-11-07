/**
 * Browser-side deployment orchestrator.
 * Coordinates complete 8-step deployment with wallet signing.
 */

export type DeploymentStep = {
  step: number;
  totalSteps?: number;
  contract: string;
  description: string;
  to: string | null;
  data: string;
  value: string;
  predictedAddress?: string;
};

export type WalletClient = {
  sendTransaction: (tx: {
    to?: string;
    data: string;
    value?: string;
  }) => Promise<string>; // Returns tx hash
  signMessage: (message: string) => Promise<string>;
};

/**
 * Sign a request for authenticated API calls.
 */
async function signRequest(
  wallet: WalletClient,
  action: string,
  payload: Record<string, unknown>,
  chainId: number
): Promise<Record<string, unknown>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const domain = "listing-day.api";
  const nonce = `${timestamp}_${Math.random().toString(36).slice(2)}`;
  
  const message = JSON.stringify({
    domain,
    action,
    chainId,
    timestamp,
    nonce,
    ticker: null,
    payloadHash: "0x" + Array.from(new TextEncoder().encode(JSON.stringify(payload)))
      .map(b => b.toString(16).padStart(2, '0')).join(''),
  });
  
  const signature = await wallet.signMessage(message);
  
  return {
    domain,
    action,
    chainId,
    timestamp,
    nonce,
    payload,
    signature,
  };
}

/**
 * Execute full 8-step deployment including auction creation.
 * 
 * @param creationId - Listing creation ID from API
 * @param wallet - Wallet client for signing
 * @param apiUrl - API base URL
 * @param onProgress - Progress callback
 */
export async function executeDeployment(
  creationId: string,
  wallet: WalletClient,
  apiUrl: string,
  onProgress: (step: number, status: string) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    const chainId = 11155111; // Sepolia
    
    // Steps 1-5: Contract deployments
    for (let step = 1; step <= 5; step++) {
      onProgress(step, "Preparing deployment...");
      
      // Get next deployment step from API
      const signedReq = await signRequest(wallet, "get_next_step", {}, chainId);
      const stepResponse = await fetch(`${apiUrl}/v1/listings/creation/${creationId}/next-step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signedReq),
      });
      
      if (!stepResponse.ok) {
        const error = await stepResponse.json();
        throw new Error(error.error?.message || "Failed to get deployment step");
      }
      
      const { step: deployStep, listing } = await stepResponse.json();
      
      if (!deployStep) {
        // Check if ready for next phase
        if (step === 5 && listing.receiverAddress) {
          break; // Move to step 6
        }
        throw new Error("No deployment step available");
      }
      
      onProgress(step, `Deploying ${deployStep.contract}...`);
      
      // Have wallet sign and send transaction
      const txParams: { to?: string; data: string; value?: string } = {
        data: deployStep.data,
      };
      
      if (deployStep.to) {
        txParams.to = deployStep.to;
      }
      
      if (deployStep.value && deployStep.value !== "0x0") {
        txParams.value = deployStep.value;
      }
      
      onProgress(step, `Waiting for wallet signature...`);
      const txHash = await wallet.sendTransaction(txParams);
      
      onProgress(step, `Transaction sent: ${txHash.slice(0, 10)}...`);
      
      // Submit tx hash to API for tracking
      const signedSubmit = await signRequest(wallet, "submit_tx", {
        txHash,
        step,
        expectedTo: deployStep.to,
        expectedData: deployStep.data,
        predictedAddress: deployStep.predictedAddress,
      }, chainId);
      
      const submitResponse = await fetch(`${apiUrl}/v1/listings/creation/${creationId}/submit-tx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signedSubmit),
      });
      
      if (!submitResponse.ok) {
        const error = await submitResponse.json();
        throw new Error(error.error?.message || "Failed to submit transaction");
      }
      
      const { listing: updated } = await submitResponse.json();
      
      onProgress(step, `${deployStep.contract} deployed!`);
      
      // Small delay before next step
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Step 6: setPolicySource
    onProgress(6, "Preparing policy source configuration...");
    const signedStep6 = await signRequest(wallet, "get_next_step", {}, chainId);
    const step6Response = await fetch(`${apiUrl}/v1/listings/creation/${creationId}/next-step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedStep6),
    });
    
    if (step6Response.ok) {
      const { step: step6Data } = await step6Response.json();
      if (step6Data) {
        onProgress(6, "Setting policy source...");
        const step6TxHash = await wallet.sendTransaction({
          to: step6Data.to,
          data: step6Data.data,
        });
        
        const signedStep6Submit = await signRequest(wallet, "submit_tx", {
          txHash: step6TxHash,
          step: 6,
        }, chainId);
        
        await fetch(`${apiUrl}/v1/listings/creation/${creationId}/submit-tx`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(signedStep6Submit),
        });
        
        onProgress(6, "Policy source configured!");
      }
    }
    
    // Step 7: Auction creation (3 sub-transactions)
    onProgress(7, "Preparing auction creation...");
    const signedAuction = await signRequest(wallet, "prepare_auction", {}, chainId);
    const auctionResponse = await fetch(`${apiUrl}/v1/listings/creation/${creationId}/prepare-auction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedAuction),
    });
    
    if (!auctionResponse.ok) {
      const error = await auctionResponse.json();
      throw new Error(error.error?.message || "Failed to prepare auction");
    }
    
    const { steps: auctionSteps, lbpStrategy } = await auctionResponse.json();
    
    // 7a: Approve Permit2
    onProgress(7, "Approving Permit2...");
    const tx7a = await wallet.sendTransaction({
      to: auctionSteps[0].to,
      data: auctionSteps[0].data,
    });
    onProgress(7, `Permit2 approved: ${tx7a.slice(0, 10)}...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 7b: Approve LiquidityLauncher via Permit2
    onProgress(7, "Approving LiquidityLauncher...");
    const tx7b = await wallet.sendTransaction({
      to: auctionSteps[1].to,
      data: auctionSteps[1].data,
    });
    onProgress(7, `LiquidityLauncher approved: ${tx7b.slice(0, 10)}...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 7c: Create auction via multicall
    onProgress(7, "Creating auction...");
    const tx7c = await wallet.sendTransaction({
      to: auctionSteps[2].to,
      data: auctionSteps[2].data,
    });
    onProgress(7, `Auction creation transaction: ${tx7c.slice(0, 10)}...`);
    
    // Submit auction tx to extract address from events
    const signedAuctionSubmit = await signRequest(wallet, "submit_auction", {
      txHash: tx7c,
      lbpStrategy,
    }, chainId);
    
    const auctionSubmitResponse = await fetch(`${apiUrl}/v1/listings/creation/${creationId}/submit-auction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedAuctionSubmit),
    });
    
    if (!auctionSubmitResponse.ok) {
      const error = await auctionSubmitResponse.json();
      throw new Error(error.error?.message || "Failed to process auction creation");
    }
    
    const { auction } = await auctionSubmitResponse.json();
    onProgress(7, `Auction created at ${auction}!`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 8: Bind auction to validation hook
    onProgress(8, "Preparing auction binding...");
    const signedSetAuction = await signRequest(wallet, "prepare_set_auction", {}, chainId);
    const setAuctionResponse = await fetch(`${apiUrl}/v1/listings/creation/${creationId}/prepare-set-auction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedSetAuction),
    });
    
    if (!setAuctionResponse.ok) {
      const error = await setAuctionResponse.json();
      throw new Error(error.error?.message || "Failed to prepare setAuction");
    }
    
    const { step: step8Data } = await setAuctionResponse.json();
    
    onProgress(8, "Binding auction to validation hook...");
    const tx8 = await wallet.sendTransaction({
      to: step8Data.to,
      data: step8Data.data,
    });
    onProgress(8, `Binding transaction: ${tx8.slice(0, 10)}...`);
    
    // Submit setAuction tx to complete deployment
    const signedSetAuctionSubmit = await signRequest(wallet, "submit_set_auction", {
      txHash: tx8,
    }, chainId);
    
    const setAuctionSubmitResponse = await fetch(`${apiUrl}/v1/listings/creation/${creationId}/submit-set-auction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signedSetAuctionSubmit),
    });
    
    if (!setAuctionSubmitResponse.ok) {
      const error = await setAuctionSubmitResponse.json();
      throw new Error(error.error?.message || "Failed to complete auction binding");
    }
    
    onProgress(8, "Deployment complete! Listing is now live.");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getAddressField(step: number): string {
  switch (step) {
    case 1: return "tokenAddress";
    case 2: return "moduleAddress";
    case 3: return "validationHookAddress";
    case 4: return "hookAddress";
    case 5: return "receiverAddress";
    default: return "tokenAddress";
  }
}
