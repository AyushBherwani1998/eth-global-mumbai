"use client";

// About (UX.md 3.10): what this is, the mock disclaimer, how private browsing
// works, credits with the TradingView NOTICE text, and the version.

import { DetailBar } from "@/components/shell";
import { useApp } from "@/components/providers";
import { Card, KV, TextLink } from "@/components/ui";
import { APP_VERSION } from "@/lib/version";
import { dateTimeIST } from "@/lib/format";
import { WALLET } from "@/lib/mock";

export function AboutScreen() {
  const { anon, network } = useApp();
  return (
    <>
      <DetailBar fallback="/" />
      <main className="max-w-[720px] pb-6">
        <h1 className="t-page-title mt-2">About Listing Day</h1>

        <section className="mt-4">
          <h2 className="t-section-title">What this is</h2>
          <p className="t-body mt-1 text-text-2">
            Listing Day is a place to buy and sell shares in small Indian companies, and to apply for their IPOs. An IPO runs as an open sale: you say
            how much you want to put in and, if you like, the most you are willing to pay. Everyone who gets shares pays the same final price. If the
            IPO does not raise enough, every application is refunded.
          </p>
          <p className="t-body mt-3 text-text-2">
            Once a company lists, its shares trade with the same kind of price limits an Indian exchange uses: a tighter range on listing day, extra
            checks when a share is under watch, and a halt when trading has to stop. Those limits are published by the exchange and enforced
            automatically, so a trade outside them is turned away rather than filled.
          </p>
        </section>

        <section className="mt-6">
          <h2 className="t-section-title">This is a mock</h2>
          <Card className="mt-1 p-4">
            <p className="t-body text-text">
              Every exchange rule here is inspired by the NSE but is not the NSE. This is not a regulated product, there are no regulatory claims, and
              nothing here is advice. Money is Sepolia test USDC with no value, and the one-person check proves only that you are a unique person: it
              is not KYC and it does not identify you.
            </p>
          </Card>
        </section>

        <section className="mt-6">
          <h2 className="t-section-title">How private browsing works</h2>
          <p className="t-body mt-1 text-text-2">
            Every price this app looks up goes through a private relay, so the data provider cannot link your internet address to the companies you
            look at. It is on by default and you can see the counters in Account, under Private browsing.
          </p>
          <p className="t-list-title mt-3 text-text">What this doesn&apos;t hide</p>
          <ul className="t-body mt-1 list-disc space-y-1 pl-5 text-text-2">
            <li>The provider still sees which companies are looked up, just not by whom.</li>
            <li>The very first connection is not private.</li>
            <li>Buying, selling and applying go through your own wallet.</li>
          </ul>
          <div className="mt-3 divide-y divide-line">
            <KV k="Relay" v={anon.transport} sub={`Fallback: ${WALLET.anonRpc.fallback}`} />
            <KV k="Private lookups" v={anon.reads.toLocaleString("en-US")} />
            <KV k="Direct lookups" v={String(anon.direct)} sub="Should always be zero" />
            <KV k="Connected since" v={dateTimeIST(anon.since)} />
          </div>
        </section>

        <section className="mt-6">
          <h2 className="t-section-title">Credits</h2>
          <p className="t-body mt-1 text-text-2">
            Charts are drawn with Lightweight Charts™ by TradingView, used under the Apache License, Version 2.0.
          </p>
          <Card className="mt-2 p-4">
            <p className="t-mono text-text">
              Lightweight Charts™
              <br />
              Copyright (с) 2025 TradingView, Inc. <TextLink href="https://www.tradingview.com/">https://www.tradingview.com/</TextLink>
            </p>
          </Card>
          <p className="t-body mt-3 text-text-2">
            Prices, companies and applications in this build come from a fixed set of sample data. Icons are from Lucide, under the ISC licence.
          </p>
        </section>

        <section className="mt-6">
          <h2 className="t-section-title">Version</h2>
          <div className="mt-1 divide-y divide-line">
            <KV k="App version" v={APP_VERSION} />
            <KV k="Data" v="Sample data, not live chain reads" />
            <KV k="Network" v={`${network.name} test network`} />
          </div>
        </section>
      </main>
    </>
  );
}
