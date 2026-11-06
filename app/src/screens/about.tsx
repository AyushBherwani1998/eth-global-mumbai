"use client";

// About (UX.md 3.10): what this is, the mock disclaimer, how private browsing
// works, credits with the TradingView NOTICE text, and the version.

import { DetailBar } from "@/components/shell";
import { useApp } from "@/components/providers";
import { Card, KV, TextLink } from "@/components/ui";
import { APP_VERSION } from "@/lib/version";
import { OFFER } from "@/lib/mock";

export function AboutScreen() {
  const { anon, network } = useApp();
  return (
    <>
      <DetailBar fallback="/" />
      <main className="max-w-[720px] pb-6">
        <h1 className="t-page-title mt-2">About thaamba</h1>

        <section className="mt-4">
          <h2 className="t-section-title">What this is</h2>
          <p className="t-body mt-1 text-text-2">
            thaamba is a place to buy and sell shares in small Indian companies, and to apply for their IPOs. An IPO runs as an open sale: you say
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
              nothing here is advice. Money is Sepolia test USDC with no value. Anyone with a wallet can apply for an IPO: nobody is identified, there
              is no KYC, and the only limit is that one wallet can put at most {OFFER.perApplicantCap} USDC into a single IPO.
            </p>
          </Card>
        </section>

        <section className="mt-6">
          <h2 className="t-section-title">How private browsing works</h2>
          <p className="t-body mt-1 text-text-2">
            Prices and company details have to be fetched from somewhere, and whoever serves them can normally see your internet address next to every
            company you look at. Private browsing sends those lookups through a relay instead, so the two cannot be tied together.
          </p>
          <p className="t-list-title mt-3 text-text">What this doesn&apos;t hide</p>
          <ul className="t-body mt-1 list-disc space-y-1 pl-5 text-text-2">
            <li>The provider still sees which companies are looked up, just not by whom.</li>
            <li>The very first connection is not private.</li>
            <li>Buying, selling and applying go through your own wallet, which has its own connection.</li>
          </ul>
          <p className="t-list-title mt-3 text-text">Where this build stands</p>
          <p className="t-body mt-1 text-text-2">
            {anon.live
              ? `Lookups are going through ${anon.transport} right now.`
              : `Not switched on yet. This build's lookups still go straight to the server, and so does the one request it makes to read your account name. The relay is ${anon.transport}, with ${anon.fallback} behind it.`}
          </p>
          <p className="t-caption mt-2">No lookup counts are shown here. Nothing is measuring that traffic yet, so there is nothing to report.</p>
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
            Icons are from Lucide, under the ISC licence.
          </p>
        </section>

        <section className="mt-6">
          <h2 className="t-section-title">Version</h2>
          <div className="mt-1 divide-y divide-line">
            <KV k="App version" v={APP_VERSION} />
            <KV k="Network" v={`${network.name} test network`} />
          </div>
        </section>
      </main>
    </>
  );
}
