/**
 * Browser-side deployment orchestrator.
 * Coordinates 5-step deployment with wallet signing.
 */

export type DeploymentStep = {
  step: number;
  totalSteps: number;
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
};

/**
 * Execute full 5-step deployment.
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
    for (let step = 1; step <= 5; step++) {
      onProgress(step, "Preparing deployment...");
      
      // Get next deployment step from API
      const stepResponse = await fetch(`${apiUrl}/v1/listings/creation/${creationId}/next-step`);
      if (!stepResponse.ok) {
        const error = await stepResponse.json();
        throw new Error(error.error?.message || "Failed to get deployment step");
      }
      
      const { step: deployStep, listing } = await stepResponse.json();
      
      if (!deployStep) {
        // Check if deployment is complete
        if (listing.phase === "completed") {
          onProgress(6, "Deployment complete!");
          return { success: true };
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
      const submitResponse = await fetch(`${apiUrl}/v1/listings/creation/${creationId}/submit-tx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash, step }),
      });
      
      if (!submitResponse.ok) {
        const error = await submitResponse.json();
        throw new Error(error.error?.message || "Failed to submit transaction");
      }
      
      const { listing: updated } = await submitResponse.json();
      
      onProgress(step, `${deployStep.contract} deployed at ${updated[getAddressField(step)] || "pending"}!`);
      
      // Small delay before next step
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    onProgress(6, "Deployment complete!");
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
