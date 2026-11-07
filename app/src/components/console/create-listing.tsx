"use client";

import { useState } from "react";
import { useWalletSession } from "@/components/wallet/session";
import { Button, Card } from "@/components/ui";
import { API_URL } from "@/lib/api";

type ListingFormData = {
  ticker: string;
  tokenName: string;
  tokenSymbol: string;
  totalSupply: string;
  auctionSupply: string;
  lpReserve: string;
  applicantCap: string;
  requiredCurrencyRaised: string;
  floorPoints: string;
  issuePoints: string;
  capPoints: string;
};

const DEFAULT_FORM_DATA: ListingFormData = {
  ticker: "",
  tokenName: "",
  tokenSymbol: "",
  totalSupply: "110000",
  auctionSupply: "90000",
  lpReserve: "20000",
  applicantCap: "20000000",
  requiredCurrencyRaised: "45000000",
  floorPoints: "80",
  issuePoints: "100",
  capPoints: "190",
};

export function CreateListingWizard({ onComplete }: { onComplete?: () => void }) {
  const wallet = useWalletSession();
  const [step, setStep] = useState<"form" | "review" | "deploying" | "complete">("form");
  const [formData, setFormData] = useState<ListingFormData>(DEFAULT_FORM_DATA);
  const [error, setError] = useState<string | null>(null);
  const [creationId, setCreationId] = useState<string | null>(null);
  const [deploymentStatus, setDeploymentStatus] = useState<string>("Preparing...");

  const updateField = (field: keyof ListingFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const validateForm = (): boolean => {
    if (!formData.ticker || !/^[a-zA-Z0-9-]+$/.test(formData.ticker)) {
      setError("Ticker must contain only letters, numbers, and hyphens");
      return false;
    }
    if (!formData.tokenName || formData.tokenName.length < 2) {
      setError("Token name must be at least 2 characters");
      return false;
    }
    if (!formData.tokenSymbol || !/^[A-Z]+$/.test(formData.tokenSymbol)) {
      setError("Token symbol must be uppercase letters only");
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setStep("review");
  };

  const handleConfirm = async () => {
    if (!wallet.connected || !wallet.address) {
      setError("Please connect your wallet first");
      return;
    }

    try {
      setStep("deploying");
      setError(null);
      setDeploymentStatus("Signing request...");

      // Check if wallet supports signing
      if (!wallet.signMessage) {
        throw new Error("Your wallet does not support message signing. Please use a different wallet.");
      }

      // Construct signed request with nonce and domain
      const timestamp = Math.floor(Date.now() / 1000);
      const chainId = 11155111; // Sepolia
      const domain = "listing-day.api";
      const nonce = `${timestamp}_${Math.random().toString(36).slice(2)}`;
      
      const payload = {
        ticker: formData.ticker.toLowerCase(),
        tokenName: formData.tokenName,
        tokenSymbol: formData.tokenSymbol,
        config: {
          totalSupply: formData.totalSupply,
          auctionSupply: formData.auctionSupply,
          lpReserve: formData.lpReserve,
          applicantCap: formData.applicantCap,
          requiredCurrencyRaised: formData.requiredCurrencyRaised,
          floorPoints: formData.floorPoints,
          issuePoints: formData.issuePoints,
          capPoints: formData.capPoints,
        },
      };

      // Compute payload hash for binding
      const payloadJson = JSON.stringify(payload);
      
      const message = JSON.stringify({
        domain,
        action: "create_listing",
        chainId,
        timestamp,
        nonce,
        ticker: null,
        payloadHash: "0x" + Array.from(new TextEncoder().encode(payloadJson))
          .map(b => b.toString(16).padStart(2, '0')).join(''),
      });

      setDeploymentStatus("Waiting for wallet signature...");
      
      // Sign message with wallet
      const signature = await wallet.signMessage(message);

      setDeploymentStatus("Creating listing...");

      // Send signed request to API
      const response = await fetch(`${API_URL}/v1/listings/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          action: "create_listing",
          chainId,
          timestamp,
          nonce,
          payload,
          signature,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "Failed to create listing");
      }

      const result = await response.json();
      const listingId = result.listing.id;
      setCreationId(listingId);
      
      setDeploymentStatus("Starting deployment...");
      
      // Execute 8-step deployment
      const { executeDeployment } = await import("./deploy-orchestrator");
      
      // Check if wallet has required capabilities
      if (!wallet.signMessage || !wallet.getEthersProvider) {
        throw new Error("Your wallet does not support required signing operations. Please use a different wallet.");
      }
      
      // Create wallet client compatible with orchestrator
      const walletClient = {
        sendTransaction: async (tx: { to?: string; data: string; value?: string }) => {
          if (!wallet.getEthersProvider) {
            throw new Error("Wallet does not support transactions");
          }
          const provider = await wallet.getEthersProvider();
          const signer = provider.getSigner();
          
          const txRequest: any = {
            to: tx.to || null,
            data: tx.data,
            value: tx.value || "0x0",
          };
          
          const txResponse = await signer.sendTransaction(txRequest);
          return txResponse.hash;
        },
        signMessage: async (message: string) => {
          if (!wallet.signMessage) {
            throw new Error("Wallet does not support message signing");
          }
          return await wallet.signMessage(message);
        },
      };
      
      const deployResult = await executeDeployment(
        listingId,
        walletClient,
        API_URL,
        (step, status) => {
          setDeploymentStatus(`Step ${step}/8: ${status}`);
        }
      );
      
      if (!deployResult.success) {
        throw new Error(deployResult.error || "Deployment failed");
      }
      
      setDeploymentStatus("Listing deployed successfully!");
      setStep("complete");
      
      if (onComplete) onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create listing");
      setStep("review");
    }
  };

  const pollDeploymentStatus = async (id: string) => {
    // Poll every 5 seconds for status updates
    const intervalId = setInterval(async () => {
      try {
        const response = await fetch(`${API_URL}/v1/listings/creation/${id}`);
        if (response.ok) {
          const listing = await response.json();
          setDeploymentStatus(`Status: ${listing.phase}`);
          
          if (listing.phase === "completed") {
            clearInterval(intervalId);
            setDeploymentStatus("Listing created successfully!");
            if (onComplete) onComplete();
          } else if (listing.phase === "error") {
            clearInterval(intervalId);
            setDeploymentStatus(`Error: ${listing.error || "Unknown error"}`);
          }
        }
      } catch (e) {
        console.error("Failed to poll status:", e);
      }
    }, 5000);

    // Stop polling after 5 minutes
    setTimeout(() => clearInterval(intervalId), 300000);
  };

  if (step === "form") {
    return (
      <Card className="p-6">
        <h2 className="t-section-title text-text mb-4">Create New Listing</h2>
        
        <div className="space-y-4">
          <div>
            <label className="t-label block mb-1">Ticker</label>
            <input
              type="text"
              value={formData.ticker}
              onChange={(e) => updateField("ticker", e.target.value.toUpperCase())}
              className="w-full px-3 py-2 border border-line rounded bg-surface text-text"
              placeholder="ACME"
            />
          </div>

          <div>
            <label className="t-label block mb-1">Token Name</label>
            <input
              type="text"
              value={formData.tokenName}
              onChange={(e) => updateField("tokenName", e.target.value)}
              className="w-full px-3 py-2 border border-line rounded bg-surface text-text"
              placeholder="Acme Corporation"
            />
          </div>

          <div>
            <label className="t-label block mb-1">Token Symbol</label>
            <input
              type="text"
              value={formData.tokenSymbol}
              onChange={(e) => updateField("tokenSymbol", e.target.value.toUpperCase())}
              className="w-full px-3 py-2 border border-line rounded bg-surface text-text"
              placeholder="ACME"
            />
          </div>

          <details className="mt-4">
            <summary className="t-label cursor-pointer text-text-2">Advanced Configuration</summary>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="t-label block mb-1">Total Supply</label>
                  <input
                    type="text"
                    value={formData.totalSupply}
                    onChange={(e) => updateField("totalSupply", e.target.value)}
                    className="w-full px-3 py-2 border border-line rounded bg-surface text-text"
                  />
                </div>
                <div>
                  <label className="t-label block mb-1">Auction Supply</label>
                  <input
                    type="text"
                    value={formData.auctionSupply}
                    onChange={(e) => updateField("auctionSupply", e.target.value)}
                    className="w-full px-3 py-2 border border-line rounded bg-surface text-text"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="t-label block mb-1">Floor Points</label>
                  <input
                    type="text"
                    value={formData.floorPoints}
                    onChange={(e) => updateField("floorPoints", e.target.value)}
                    className="w-full px-3 py-2 border border-line rounded bg-surface text-text"
                  />
                </div>
                <div>
                  <label className="t-label block mb-1">Cap Points</label>
                  <input
                    type="text"
                    value={formData.capPoints}
                    onChange={(e) => updateField("capPoints", e.target.value)}
                    className="w-full px-3 py-2 border border-line rounded bg-surface text-text"
                  />
                </div>
              </div>
            </div>
          </details>

          {error && (
            <div className="p-3 bg-loss-bg border border-loss-border rounded text-loss-text">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button onClick={handleSubmit} className="flex-1">
              Continue
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (step === "review") {
    return (
      <Card className="p-6">
        <h2 className="t-section-title text-text mb-4">Review Listing</h2>
        
        <div className="space-y-3 mb-6">
          <div className="flex justify-between py-2 border-b border-line">
            <span className="t-label">Ticker:</span>
            <span className="t-body text-text">{formData.ticker}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-line">
            <span className="t-label">Token Name:</span>
            <span className="t-body text-text">{formData.tokenName}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-line">
            <span className="t-label">Symbol:</span>
            <span className="t-body text-text">{formData.tokenSymbol}</span>
          </div>
        </div>

        {error && (
          <div className="p-3 mb-4 bg-loss-bg border border-loss-border rounded text-loss-text">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setStep("form")} className="flex-1">
            Back
          </Button>
          <Button onClick={handleConfirm} className="flex-1">
            Create Listing
          </Button>
        </div>
      </Card>
    );
  }

  if (step === "deploying" || step === "complete") {
    return (
      <Card className="p-6">
        <h2 className="t-section-title text-text mb-4">
          {step === "deploying" ? "Creating Listing..." : "Listing Created"}
        </h2>
        
        <div className="space-y-4">
          <p className="t-body text-text">{deploymentStatus}</p>
          
          {creationId && (
            <div className="p-3 bg-surface-2 border border-line rounded">
              <p className="t-label mb-1">Creation ID:</p>
              <p className="t-mono text-text break-all">{creationId}</p>
            </div>
          )}

          {step === "complete" && (
            <Button onClick={() => onComplete?.()} className="w-full">
              View Listing
            </Button>
          )}
        </div>
      </Card>
    );
  }

  return null;
}
