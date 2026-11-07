#!/usr/bin/env node
/* eslint-env node */
/**
 * BUILD-TIME TOOL: Extract deployment bytecode from forge build output.
 * 
 * This is run ONCE during development to extract bytecode artifacts.
 * The extracted JSON files are committed to the repo and bundled with the API.
 * 
 * NO RUNTIME FORGE DEPENDENCY: The API loads pre-compiled bytecode from JSON files.
 * 
 * Usage:
 *   cd contracts && forge build
 *   cd ../services/api && node scripts/extract-bytecode-from-forge.mjs
 *   git add src/bytecode/*.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, '../../../contracts');
const OUT_DIR = resolve(CONTRACTS_DIR, 'out');
const OUTPUT_DIR = resolve(__dirname, '../src/bytecode');

const CONTRACTS = [
  { name: 'MockSME', path: 'MockSME.sol/MockSME.json' },
  { name: 'AllowAllModule', path: 'AllowAllModule.sol/AllowAllModule.json' },
  { name: 'AuctionValidationHook', path: 'AuctionValidationHook.sol/AuctionValidationHook.json' },
  { name: 'ListingHook', path: 'ListingHook.sol/ListingHook.json' },
  { name: 'ListingPolicyReceiver', path: 'ListingPolicyReceiver.sol/ListingPolicyReceiver.json' },
];

console.log('Extracting deployment bytecode from forge build output...');

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

let extracted = 0;

for (const contract of CONTRACTS) {
  const artifactPath = resolve(OUT_DIR, contract.path);
  
  if (!existsSync(artifactPath)) {
    console.error(`✗ ${contract.name}: artifact not found at ${artifactPath}`);
    continue;
  }
  
  try {
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    const bytecode = artifact.bytecode?.object;
    
    if (!bytecode || bytecode === '0x') {
      console.error(`✗ ${contract.name}: no bytecode in artifact`);
      continue;
    }
    
    const output = {
      contractName: contract.name,
      bytecode,
      compiler: {
        version: artifact.metadata?.compiler?.version || 'unknown',
        settings: artifact.metadata?.settings || {},
      },
      extractedAt: new Date().toISOString(),
      source: 'forge build',
      artifactPath: contract.path,
    };
    
    const outputFile = resolve(OUTPUT_DIR, `${contract.name}.json`);
    writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log(`✓ ${contract.name} (${bytecode.length} chars)`);
    extracted++;
  } catch (error) {
    console.error(`✗ ${contract.name}: ${error.message}`);
  }
}

console.log(`\n✓ Extracted ${extracted}/${CONTRACTS.length} contracts`);
console.log(`\nCommit the bytecode artifacts:`);
console.log(`  git add services/api/src/bytecode/*.json`);
console.log(`  git commit -m "chore: add compiled contract bytecode artifacts"`);

if (extracted < CONTRACTS.length) {
  process.exit(1);
}
