#!/usr/bin/env node
// Walk the entire Wallets CRUD from the operator socket: list → create → update →
// select → empty → delete. Each step prints the result and raises on first failure.
import { io } from 'socket.io-client';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:3005';
const OP_KEY = process.env.OPERATOR_API_KEY || 'Narciso';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  console.error('Need ADMIN_TOKEN env var');
  process.exit(1);
}

const sock = io(`${BACKEND}/operator`, {
  auth: { token: ADMIN_TOKEN, apiKey: OP_KEY, operatorName: 'e2e-admin' },
  transports: ['websocket'],
});

const emit = (event, data, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} timeout`)), timeoutMs);
    sock.emit(event, data, (ack) => {
      clearTimeout(t);
      resolve(ack);
    });
  });

sock.on('connect', async () => {
  console.log(`connected: ${sock.id}\n`);
  try {
    // 1. LIST initial
    console.log('1) get_wallets (initial)');
    let r = await emit('get_wallets', {});
    console.log(`   ack=${JSON.stringify(r).substring(0, 100)}...`);
    const initialWallets = r?.data || r?.wallets || [];
    console.log(`   wallets count: ${initialWallets.length}`);

    // 2. CREATE
    console.log('\n2) create_wallet');
    r = await emit('create_wallet', {
      type: 'MERCADOPAGO',
      label: 'E2E Test Wallet',
      holderName: 'E2E Holder',
      holderDni: '12345678',
      details: { alias: 'e2e.crud.test', cvu: '0000003100000000000099' },
      isActive: true,
      requiresVerification: false,
      amountLimit: 500000,
    });
    console.log(`   ack=${JSON.stringify(r).substring(0, 200)}`);
    const createdWallet = r?.data || r?.wallet;
    if (!createdWallet?.id) throw new Error(`create_wallet did not return wallet.id`);
    const newWalletId = createdWallet.id;
    console.log(`   ✓ created id=${newWalletId}`);

    // 3. UPDATE
    console.log('\n3) update_wallet');
    r = await emit('update_wallet', {
      id: newWalletId,
      label: 'E2E Test Wallet (updated)',
      amountLimit: 750000,
    });
    console.log(`   ack=${JSON.stringify(r).substring(0, 200)}`);

    // 4. SELECT (make this the active one)
    console.log('\n4) select_wallet');
    r = await emit('select_wallet', { id: newWalletId });
    console.log(`   ack=${JSON.stringify(r).substring(0, 200)}`);

    // 5. EMPTY (reset accumulated)
    console.log('\n5) empty_wallet');
    r = await emit('empty_wallet', { id: newWalletId });
    console.log(`   ack=${JSON.stringify(r).substring(0, 200)}`);

    // 6. LIST again to see the changes
    console.log('\n6) get_wallets (after CRUD)');
    r = await emit('get_wallets', {});
    const list = r?.data || r?.wallets || [];
    const found = list.find((w) => w.id === newWalletId);
    console.log(`   ✓ found in list: label="${found?.label}" amountLimit=${found?.amountLimit} accumulated=${found?.accumulatedAmount} isSelected=${found?.isSelected}`);

    // 7. DELETE
    console.log('\n7) delete_wallet');
    r = await emit('delete_wallet', { id: newWalletId });
    console.log(`   ack=${JSON.stringify(r).substring(0, 200)}`);

    // 8. Verify gone
    console.log('\n8) get_wallets (after delete)');
    r = await emit('get_wallets', {});
    const list2 = r?.data || r?.wallets || [];
    const stillThere = list2.find((w) => w.id === newWalletId);
    console.log(`   ✓ wallet ${stillThere ? 'STILL PRESENT (soft delete?)' : 'GONE (hard delete)'}`);
    if (stillThere) {
      console.log(`     isActive=${stillThere.isActive}, isSelected=${stillThere.isSelected}`);
    }

    console.log('\n✅ Wallets CRUD complete');
    sock.disconnect();
    process.exit(0);
  } catch (e) {
    console.error(`\n❌ FAIL: ${e.message}`);
    sock.disconnect();
    process.exit(1);
  }
});

sock.on('connect_error', (e) => { console.error('connect_error:', e.message); process.exit(2); });
sock.on('error', (e) => console.error('socket error:', e));
