#!/usr/bin/env node
/**
 * Extract deployment bytecode from forge broadcast artifacts.
 * Run this after `forge build && forge script` to extract bytecode for runtime use.
 * 
 * Usage: node scripts/extract-bytecode.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, '../../../contracts');
const BROADCAST_FILE = resolve(CONTRACTS_DIR, 'test/fixtures/broadcast/DemoDeploy.s.sol/31337/run-latest.json');
const OUTPUT_DIR = resolve(__dirname, '../src/bytecode');

const CONTRACTS_TO_EXTRACT = [
  'MockSME',
  'AllowAllModule',
  'AuctionValidationHook',
  'ListingHook',
  'ListingPolicyReceiver'
];

console.log('Extracting deployment bytecode from forge broadcast artifacts...');

if (!existsSync(BROADCAST_FILE)) {
  console.error(`Broadcast file not found: ${BROADCAST_FILE}`);
  console.error('Run: cd contracts && forge script script/demo/DemoDeploy.s.sol --fork-url http://localhost:8545');
  process.exit(1);
}

const broadcast = JSON.parse(readFileSync(BROADCAST_FILE, 'utf8'));

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

let extracted = 0;

for (const tx of broadcast.transactions || []) {
  if (tx.transactionType === 'CREATE' && CONTRACTS_TO_EXTRACT.includes(tx.contractName)) {
    const bytecode = {
      contractName: tx.contractName,
      bytecode: tx.transaction.data,
      // Constructor will be encoded in the data, we store creation bytecode
      extractedAt: new Date().toISOString(),
      source: 'forge broadcast DemoDeploy.s.sol',
    };
    
    const outputFile = resolve(OUTPUT_DIR, `${tx.contractName}.json`);
    writeFileSync(outputFile, JSON.stringify(bytecode, null, 2));
    console.log(`✓ Extracted ${tx.contractName} (${tx.transaction.data.length} bytes)`);
    extracted++;
  }
}

console.log(`\nExtracted ${extracted}/${CONTRACTS_TO_EXTRACT.length} contracts`);

if (extracted < CONTRACTS_TO_EXTRACT.length) {
  console.warn('\nSome contracts not found. Make sure DemoDeploy.s.sol was run successfully.');
}
