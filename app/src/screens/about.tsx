"use client";

import { DetailHeader } from "@/components/shell";
import { Card } from "@/components/ui";

export function AboutScreen() {
  return (
    <>
      <DetailHeader />
      <main className="space-y-4 px-4">
        <h1 className="text-[22px]">About Listing Day</h1>
        <p className="text-[14px]">
          A mock Indian SME IPO on Ethereum Sepolia. Price discovery runs on a Uniswap Continuous Clearing Auction; the
          token then lists in a Uniswap v4 pool whose ListingHook enforces NSE-inspired listing-day and circuit rules.
        </p>
        <Card className="p-3 text-[13px] text-text-2">
          Every exchange rule here is an <b>NSE-inspired mock</b>: not a regulated product, no regulatory claims. The
          World ID check proves uniqueness only; it is <b>not KYC</b>. Prices are in Sepolia test USDC.
        </Card>
        <section>
          <h2 className="text-[17px]">Credits</h2>
          <p className="mt-1 text-[13px] text-text-2">
            Charts use TradingView Lightweight Charts™, Copyright (c) 2025 TradingView, Inc.{" "}
            <a className="prose-link text-gain-text" href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
              https://www.tradingview.com/
            </a>
            . Licensed under the Apache License, Version 2.0.
          </p>
        </section>
      </main>
    </>
  );
}
