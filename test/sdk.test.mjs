// Tests contre de faux serveurs Xpaye / CinetPay (serveur HTTP local).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import {
  PaymentClient,
  XpayeProvider,
  CinetPayProvider,
  detectCiOperator,
  normalizeCiPhone,
  toE164Ci,
  ValidationError,
  ProviderUnavailableError,
  WebhookVerificationError,
  AmountMismatchError,
  computeXpayeHashcode,
  redactFields,
  XPAYE_CHANNEL_CODES,
} from 'mobile-money-kit';

const SECRET = 'un-secret-de-webhook-tres-long-0123456789';

/** Démarre un faux agrégateur. handler(req, body) → [status, json]. */
async function fakeServer(handler) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : null;
      calls.push({ url: req.url, headers: req.headers, body: parsed });
      const [status, json] = handler(req, parsed);
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() };
}

const baseRequest = {
  reference: 'CMD-1001',
  amount: 2000,
  description: 'Abonnement Premium',
  customer: { firstName: 'Awa', lastName: 'Koné', email: 'awa@example.com', phone: '07 07 07 07 07' },
  returnUrl: 'https://monapp.ci/merci',
  notifyUrl: 'https://monapp.ci/api/paiement/notify',
};

// ---------------------------------------------------------------- téléphone

test('numéros ivoiriens : normalisation et opérateur', () => {
  assert.equal(normalizeCiPhone('+225 07 07 07 07 07'), '0707070707');
  assert.equal(normalizeCiPhone('00225 0505050505'), '0505050505');
  assert.equal(normalizeCiPhone('12345'), null);
  assert.equal(toE164Ci('01-02-03-04-05'), '+2250102030405');
  assert.equal(detectCiOperator('0707070707'), 'ORANGE_CI');
  assert.equal(detectCiOperator('+2250505050505'), 'MTN_CI');
  assert.equal(detectCiOperator('0101010101'), 'MOOV_CI');
  assert.equal(detectCiOperator('2721000000'), null);
});

// ---------------------------------------------------------------- Xpaye

test('xpaye : initialisation avec canal déduit du numéro et jeton de notification', async () => {
  const srv = await fakeServer(() => [200, { success: true, message: 'ok', url: 'https://pay.example/s?sessionid=abc' }]);
  try {
    const xpaye = new XpayeProvider({ merchantId: 'PP-TEST', webhookSecret: SECRET, initUrl: `${srv.url}/init` });
    const client = new PaymentClient({ providers: [xpaye] });
    const session = await client.createPayment({ ...baseRequest, channel: 'MOBILE_MONEY' });

    assert.equal(session.provider, 'xpaye');
    assert.equal(session.paymentUrl, 'https://pay.example/s?sessionid=abc');
    const sent = srv.calls[0].body;
    assert.equal(sent.channel, 'OMCIV2'); // 07 → Orange CI
    assert.equal(sent.countryCurrencyCode, '952');
    assert.equal(sent.referenceNumber, 'CMD-1001');
    const notifyUrl = new URL(sent.notificationURL);
    assert.equal(notifyUrl.searchParams.get('nt'), xpaye.notifyToken('CMD-1001'));
    assert.equal(new URL(sent.returnURL).searchParams.get('nt'), null, 'le jeton ne doit jamais aller dans returnURL');
    assert.equal(JSON.parse(sent.returnContext).ref, 'CMD-1001');
  } finally {
    srv.close();
  }
});

test('xpaye : canal Wave explicite et erreurs de validation', async () => {
  const srv = await fakeServer(() => [200, { success: false, message: 'Référence déjà utilisée' }]);
  try {
    const xpaye = new XpayeProvider({ merchantId: 'PP-TEST', initUrl: `${srv.url}/init` });
    const client = new PaymentClient({ providers: [xpaye] });
    await assert.rejects(client.createPayment({ ...baseRequest, channel: 'WAVE_CI' }), /Référence déjà utilisée/);
    assert.equal(srv.calls[0].body.channel, 'WAVECI');

    // Numéro fixe : impossible de deviner l'opérateur
    await assert.rejects(
      client.createPayment({ ...baseRequest, customer: { ...baseRequest.customer, phone: '2721000000' } }),
      ValidationError
    );
    await assert.rejects(client.createPayment({ ...baseRequest, amount: 10.5 }), ValidationError);
    await assert.rejects(client.createPayment({ ...baseRequest, notifyUrl: 'http://monapp.ci/x' }), /https/);
    assert.throws(() => new XpayeProvider({ merchantId: 'X', webhookSecret: 'court' }), /32 caractères/);
  } finally {
    srv.close();
  }
});

test('xpaye : notification authentifiée par le jeton → succès, montant contrôlé', async () => {
  const xpaye = new XpayeProvider({ merchantId: 'PP-TEST', webhookSecret: SECRET });
  const client = new PaymentClient({ providers: [xpaye] });
  const token = xpaye.notifyToken('CMD-1001');
  const body = 'merchantId=PP-TEST&referenceNumber=CMD-1001&amount=2000&responsecode=0&channel=WAVECI&hashcode=xyz';

  const result = await client.handleWebhook(
    'xpaye',
    { url: `/api/paiement/notify?nt=${token}`, body },
    { expectedAmount: async (ref) => (ref === 'CMD-1001' ? 2000 : undefined) }
  );
  assert.equal(result.status, 'success');
  assert.equal(result.verifiedBy, 'notify-token');
  assert.equal(result.method, 'WAVECI');

  // Même notification, montant falsifié
  await assert.rejects(
    client.handleWebhook('xpaye', { url: `/n?nt=${token}`, body: body.replace('amount=2000', 'amount=5') }, { expectedAmount: 2000 }),
    AmountMismatchError
  );
});

test('xpaye : notification forgée (sans jeton, mauvais jeton, autre référence) rejetée', async () => {
  const xpaye = new XpayeProvider({ merchantId: 'PP-TEST', webhookSecret: SECRET });
  const client = new PaymentClient({ providers: [xpaye] });
  const body = { referenceNumber: 'CMD-1001', amount: '2000', responsecode: '0' };

  await assert.rejects(client.handleWebhook('xpaye', { url: '/n', body }), WebhookVerificationError);
  await assert.rejects(client.handleWebhook('xpaye', { url: '/n?nt=faux', body }), WebhookVerificationError);
  // Jeton valide d'un AUTRE paiement réutilisé
  const otherToken = xpaye.notifyToken('CMD-9999');
  await assert.rejects(client.handleWebhook('xpaye', { url: `/n?nt=${otherToken}`, body }), WebhookVerificationError);
  // Mauvais marchand
  await assert.rejects(
    client.handleWebhook('xpaye', { url: `/n?nt=${xpaye.notifyToken('CMD-1001')}`, body: { ...body, merchantId: 'PP-AUTRE' } }),
    ValidationError
  );
});

test('xpaye : référence retrouvée dans returnContext, vérification hashcode personnalisée', async () => {
  const xpaye = new XpayeProvider({
    merchantId: 'PP-TEST',
    verifyHashcode: (f) => f.hashcode === 'bon-hash',
  });
  const client = new PaymentClient({ providers: [xpaye] });
  const body = { returnContext: JSON.stringify({ ref: 'CMD-7', data: null }), amount: 100, responsecode: '-1', hashcode: 'bon-hash' };
  const result = await client.handleWebhook('xpaye', { body });
  assert.equal(result.reference, 'CMD-7');
  assert.equal(result.status, 'failed');
  assert.equal(result.verifiedBy, 'signature');
});

test('xpaye : notification réelle (corps vide, paramètres collés par « ? ») acceptée', async () => {
  const xpaye = new XpayeProvider({ merchantId: 'PP-TEST', webhookSecret: SECRET });
  const client = new PaymentClient({ providers: [xpaye] });
  const token = xpaye.notifyToken('CMD-1001');
  // Format observé en production : XPAYE ajoute « ?… » derrière notre query string.
  const url =
    `https://monapp.ci/api/paiement/notify?provider=xpaye&nt=${token}` +
    '?merchantId=PP-TEST&amount=2000&referenceNumber=CMD-1001&responsecode=0&channel=WAVECI&transactiondt=2026-09-05';

  const result = await client.handleNotification({ url, body: '' }, { expectedAmount: 2000 });
  assert.equal(result.status, 'success');
  assert.equal(result.verifiedBy, 'notify-token');
  assert.equal(result.amount, 2000);
  assert.equal(result.raw.nt, undefined, 'le jeton ne doit pas finir dans raw (stocké en base)');
});

test('xpaye : hashcode intégré (formule confirmée) et règles du jeton', async () => {
  const fields = { merchantId: 'PP-TEST', referenceNumber: 'CMD-1001', amount: '2000', responsecode: '0' };
  const hashcode = computeXpayeHashcode(fields, 'cle');
  assert.equal(hashcode, createHash('sha256').update('CMD-1001|2000|PP-TEST|cle').digest('hex'));

  // Pas de webhookSecret : le hashcode valide authentifie.
  const hashOnly = new PaymentClient({ providers: [new XpayeProvider({ merchantId: 'PP-TEST', secretKey: 'cle' })] });
  const ok = await hashOnly.handleWebhook('xpaye', { body: { ...fields, hashcode } });
  assert.equal(ok.verifiedBy, 'signature');

  const xpaye = new XpayeProvider({ merchantId: 'PP-TEST', secretKey: 'cle', webhookSecret: SECRET });
  const client = new PaymentClient({ providers: [xpaye] });
  const token = xpaye.notifyToken('CMD-1001');

  // Hashcode faux → rejet, même avec un jeton valide.
  await assert.rejects(
    client.handleWebhook('xpaye', { url: `/n?nt=${token}`, body: { ...fields, hashcode: 'ab'.repeat(32) } }),
    /hashcode invalide/
  );
  // webhookSecret fourni : le jeton est exigé, un hashcode valide seul ne suffit pas
  // (il pourrait venir d'une tentative échouée, le statut n'étant pas signé).
  await assert.rejects(client.handleWebhook('xpaye', { body: { ...fields, hashcode } }), WebhookVerificationError);
  const both = await client.handleWebhook('xpaye', { url: `/n?nt=${token}`, body: { ...fields, hashcode } });
  assert.equal(both.verifiedBy, 'notify-token');

  // Désactivation explicite (le temps de confirmer que le jeton arrive bien)
  const lenient = new PaymentClient({
    providers: [new XpayeProvider({ merchantId: 'PP-TEST', secretKey: 'cle', webhookSecret: SECRET, requireNotifyToken: false })],
  });
  assert.equal((await lenient.handleWebhook('xpaye', { body: { ...fields, hashcode } })).verifiedBy, 'signature');
  assert.throws(() => new XpayeProvider({ merchantId: 'X', requireNotifyToken: true }), /webhookSecret/);
});

test('xpaye : statut inconnu en attente, montant « 2 000 », référence opérateur', async () => {
  const xpaye = new XpayeProvider({ merchantId: 'PP-TEST', webhookSecret: SECRET });
  const client = new PaymentClient({ providers: [xpaye] });
  const url = `/n?nt=${xpaye.notifyToken('CMD-1001')}`;
  const body = { referenceNumber: 'CMD-1001', amount: '2 000', responsecode: '0', transactiondt: 'TX-42' };

  const ok = await client.handleWebhook('xpaye', { url, body }, { expectedAmount: 2000 });
  assert.equal(ok.status, 'success');
  assert.equal(ok.amount, 2000);
  assert.equal(ok.operatorReference, 'TX-42');

  assert.equal((await client.handleWebhook('xpaye', { url, body: { ...body, responsecode: '-1' } })).status, 'failed');
  // Code inattendu : ni crédité ni marqué échoué.
  assert.equal((await client.handleWebhook('xpaye', { url, body: { ...body, responsecode: '2' } })).status, 'pending');
  assert.equal((await client.handleWebhook('xpaye', { url, body: { ...body, responsecode: '' } })).status, 'pending');
});

test('xpaye : reprise d\'une intégration maison (jeton « notify: », returnContext existant)', async () => {
  const xpaye = new XpayeProvider({ merchantId: 'PP-TEST', webhookSecret: SECRET, notifyTokenPrefix: 'notify:' });
  const client = new PaymentClient({ providers: [xpaye] });
  const legacyToken = createHmac('sha256', SECRET).update('notify:LEGACY-abc-1').digest('hex');
  assert.equal(xpaye.notifyToken('LEGACY-abc-1'), legacyToken);

  for (const ctx of [{ reference_number: 'LEGACY-abc-1' }, { reference: 'LEGACY-abc-1', order: 'x' }]) {
    const result = await client.handleWebhook('xpaye', {
      url: `/n?nt=${legacyToken}`,
      body: { returnContext: JSON.stringify(ctx), amount: '1000', responsecode: '0' },
    });
    assert.equal(result.reference, 'LEGACY-abc-1');
    assert.equal(result.verifiedBy, 'notify-token');
  }
});

test('xpaye : canaux de la documentation officielle, devise contrôlée', async () => {
  const srv = await fakeServer(() => [200, { success: true, url: 'https://pay.example/s' }]);
  try {
    const xpaye = new XpayeProvider({ merchantId: 'PP-TEST', initUrl: `${srv.url}/init` });
    const client = new PaymentClient({ providers: [xpaye] });

    // Les 18 codes listés sur sandbox.paiementpro.net/test-sandbox.html, ni plus ni moins.
    assert.deepEqual(Object.values(XPAYE_CHANNEL_CODES).sort(), [
      'AIRTELNG', 'CARD', 'FLOOZ', 'FLOOZBJ', 'MOMOBJ', 'MOMOCI', 'MOMOCM', 'MOOTG', 'OMBF',
      'OMCIV2', 'OMCM', 'OMGN', 'OMML', 'OMSN', 'PAYPAL', 'TOGOCEL', 'WAVECI', 'WAVESN',
    ]);
    // Chaque canal a un libellé pour l'écran de choix.
    assert.equal(client.availableChannels().length, 18);
    assert.equal(client.availableChannels(['PAYPAL'])[0].kind, 'wallet');

    // Numéro Moov ivoirien avec canal à déduire → FLOOZ.
    await client.createPayment({ ...baseRequest, channel: 'MOBILE_MONEY', customer: { ...baseRequest.customer, phone: '0101010101' } });
    assert.equal(srv.calls.at(-1).body.channel, 'FLOOZ');

    // Cameroun : XAF obligatoire (code 950).
    await assert.rejects(client.createPayment({ ...baseRequest, channel: 'MTN_CM' }), /exige la devise XAF/);
    await client.createPayment({ ...baseRequest, channel: 'MTN_CM', currency: 'XAF' });
    assert.equal(srv.calls.at(-1).body.channel, 'MOMOCM');
    assert.equal(srv.calls.at(-1).body.countryCurrencyCode, '950');
    await assert.rejects(client.createPayment({ ...baseRequest, channel: 'ORANGE_SN', currency: 'XAF' }), /exige la devise XOF/);
    // Moyens internationaux : pas de contrainte de devise.
    await client.createPayment({ ...baseRequest, channel: 'CARD', currency: 'XAF' });

    // Code ajouté par l'intégrateur (sa responsabilité), retrait d'un canal, description ≤ 100 car.
    const custom = new PaymentClient({
      providers: [
        new XpayeProvider({
          merchantId: 'PP-TEST',
          initUrl: `${srv.url}/init`,
          channelCodes: { MOOV_CI: 'CODE_FOURNI_PAR_XPAYE', CARD: null },
        }),
      ],
    });
    assert.ok(!custom.availableChannels().some((c) => c.channel === 'CARD'));
    await custom.createPayment({ ...baseRequest, channel: 'MOOV_CI', description: 'x'.repeat(150) });
    assert.equal(srv.calls.at(-1).body.channel, 'CODE_FOURNI_PAR_XPAYE');
    assert.equal(srv.calls.at(-1).body.description.length, 100);
  } finally {
    srv.close();
  }
});

test('l\'intégrateur choisit ses moyens de paiement (option channels)', async () => {
  const srv = await fakeServer(() => [200, { success: true, url: 'https://pay.example/s' }]);
  try {
    const client = new PaymentClient({
      providers: [new XpayeProvider({ merchantId: 'PP-TEST', initUrl: `${srv.url}/init` })],
      channels: ['WAVE_CI', 'ORANGE_CI'],
    });
    assert.deepEqual(client.availableChannels().map((c) => c.channel), ['WAVE_CI', 'ORANGE_CI']);
    // `only` ne peut pas réintroduire un canal exclu
    assert.deepEqual(client.availableChannels(['CARD', 'ORANGE_CI']).map((c) => c.channel), ['ORANGE_CI']);
    await client.createPayment({ ...baseRequest, channel: 'WAVE_CI' });
    await assert.rejects(client.createPayment({ ...baseRequest, channel: 'CARD' }), /non proposé : CARD/);
    await assert.rejects(client.createPayment({ ...baseRequest, channel: 'MOBILE_MONEY' }), /non proposé/);
    assert.equal(srv.calls.length, 1, 'aucun appel à l\'agrégateur pour un canal refusé');

    assert.throws(
      () => new PaymentClient({ providers: [new XpayeProvider({ merchantId: 'X', channelCodes: { MOOV_CI: null } })], channels: ['MOOV_CI'] }),
      /non supportés.*MOOV_CI/
    );
    assert.throws(() => new PaymentClient({ providers: [new XpayeProvider({ merchantId: 'X' })], channels: [] }), /vide/);
  } finally {
    srv.close();
  }
});

test('redactFields masque signatures, jetons et e-mails', () => {
  const out = redactFields({ hashcode: 'abcdef123456', nt: 'secretjeton', customerId: 'awa.kone@example.com', amount: '2000' });
  assert.equal(out.hashcode, 'abcd…(masqué)');
  assert.equal(out.nt, 'secr…(masqué)');
  assert.equal(out.customerId, 'aw***@example.com');
  assert.equal(out.amount, '2000');
});

// ---------------------------------------------------------------- CinetPay

function cinetpayServer(state) {
  return fakeServer((req, body) => {
    if (req.url.endsWith('/payment')) {
      return [200, { code: '201', message: 'CREATED', data: { payment_token: 'tok', payment_url: 'https://checkout.example/tok' } }];
    }
    if (req.url.endsWith('/payment/check')) {
      return [200, state.check(body)];
    }
    return [404, {}];
  });
}

test('cinetpay : initialisation (canaux, en-têtes, montant multiple de 5)', async () => {
  const srv = await cinetpayServer({});
  try {
    const cp = new CinetPayProvider({ apiKey: 'k', siteId: '123', apiUrl: srv.url });
    const client = new PaymentClient({ providers: [cp] });
    const session = await client.createPayment({ ...baseRequest, channel: 'ORANGE_CI', description: 'Achat #12 & co' });
    assert.equal(session.paymentUrl, 'https://checkout.example/tok');
    assert.equal(session.providerToken, 'tok');
    const { body, headers } = srv.calls[0];
    assert.equal(body.channels, 'MOBILE_MONEY');
    assert.equal(body.transaction_id, 'CMD-1001');
    assert.equal(body.description.includes('#'), false);
    assert.equal(headers['user-agent'], 'mobile-money-kit');
    await assert.rejects(client.createPayment({ ...baseRequest, amount: 2003 }), /multiple de 5/);
  } finally {
    srv.close();
  }
});

test('cinetpay : la notification est toujours reconfirmée par l\'API de statut', async () => {
  const state = {
    check: () => ({ code: '00', message: 'SUCCES', data: { amount: '2000', currency: 'XOF', status: 'ACCEPTED', payment_method: 'OM', operator_id: 'OP1', payment_date: '2026-10-06 10:00:00' } }),
  };
  const srv = await cinetpayServer(state);
  try {
    const secretKey = 'secret-cinetpay';
    const cp = new CinetPayProvider({ apiKey: 'k', siteId: '123', secretKey, apiUrl: srv.url });
    const client = new PaymentClient({ providers: [cp] });
    const fields = { cpm_site_id: '123', cpm_trans_id: 'CMD-1001', cpm_amount: '2000', cpm_currency: 'XOF', payment_method: 'OM' };
    const order = ['cpm_site_id', 'cpm_trans_id', 'cpm_trans_date', 'cpm_amount', 'cpm_currency', 'signature', 'payment_method', 'cel_phone_num', 'cpm_phone_prefixe', 'cpm_language', 'cpm_version', 'cpm_payment_config', 'cpm_page_action', 'cpm_custom', 'cpm_designation', 'cpm_error_message'];
    const xToken = createHmac('sha256', secretKey).update(order.map((f) => fields[f] ?? '').join('')).digest('hex');
    const body = new URLSearchParams(fields).toString();

    const ok = await client.handleWebhook('cinetpay', { headers: { 'X-Token': xToken }, body }, { expectedAmount: 2000 });
    assert.equal(ok.status, 'success');
    assert.equal(ok.verifiedBy, 'status-api');
    assert.equal(ok.operatorReference, 'OP1');

    // x-token falsifié → rejet immédiat
    await assert.rejects(client.handleWebhook('cinetpay', { headers: { 'x-token': 'faux' }, body }), WebhookVerificationError);

    // Notification « payée » mais CinetPay dit refusé → échec (la notification seule ne crédite jamais)
    state.check = () => ({ code: '627', message: 'TRANSACTION_CANCEL', data: { amount: '2000', status: 'REFUSED' } });
    assert.equal((await client.handleWebhook('cinetpay', { body })).status, 'failed');

    state.check = () => ({ code: '662', message: 'WAITING_CUSTOMER_PAYMENT', data: { status: 'WAITING_FOR_CUSTOMER' } });
    assert.equal((await client.getStatus('cinetpay', 'CMD-1001')).status, 'pending');
  } finally {
    srv.close();
  }
});

// ---------------------------------------------------------------- bascule

test('bascule automatique si le premier agrégateur est en panne', async () => {
  const down = await fakeServer(() => [503, { error: 'maintenance' }]);
  const cpSrv = await cinetpayServer({});
  try {
    const switches = [];
    const client = new PaymentClient({
      providers: [
        new XpayeProvider({ merchantId: 'PP-TEST', initUrl: `${down.url}/init` }),
        new CinetPayProvider({ apiKey: 'k', siteId: '123', apiUrl: cpSrv.url }),
      ],
      onFallback: (from, err, to) => switches.push([from, to, err.name]),
    });
    const session = await client.createPayment({ ...baseRequest, channel: 'ORANGE_CI' });
    assert.equal(session.provider, 'cinetpay');
    assert.deepEqual(switches, [['xpaye', 'cinetpay', 'ProviderUnavailableError']]);

    // Sans bascule, l'erreur remonte
    const strict = new PaymentClient({ providers: client['providers'], fallback: false });
    await assert.rejects(strict.createPayment({ ...baseRequest, channel: 'ORANGE_CI' }), ProviderUnavailableError);
  } finally {
    down.close();
    cpSrv.close();
  }
});

test('agrégateur injoignable (réseau) → ProviderUnavailableError', async () => {
  const client = new PaymentClient({
    providers: [new XpayeProvider({ merchantId: 'PP-TEST', initUrl: 'http://127.0.0.1:9/init' })],
  });
  await assert.rejects(client.createPayment({ ...baseRequest, channel: 'WAVE_CI' }), ProviderUnavailableError);
});

test('handleNotification reconnaît l\'agrégateur via notifyUrl, même après bascule', async () => {
  const down = await fakeServer(() => [503, {}]);
  const cpSrv = await cinetpayServer({});
  const xpSrv = await fakeServer(() => [200, { success: true, url: 'https://pay.example/x' }]);
  try {
    const xpaye = new XpayeProvider({ merchantId: 'PP-TEST', webhookSecret: SECRET, initUrl: `${xpSrv.url}/init` });
    const client = new PaymentClient({ providers: [xpaye] });
    await client.createPayment({ ...baseRequest, channel: 'WAVE_CI', notifyUrl: 'https://monapp.ci/notify?x=1' });
    const notifyUrl = srvNotifyUrl(xpSrv.calls[0].body.notificationURL);
    assert.equal(notifyUrl.searchParams.get('provider'), 'xpaye');
    assert.equal(notifyUrl.searchParams.get('x'), '1');

    // Xpaye rappelle exactement cette URL
    const result = await client.handleNotification({
      url: notifyUrl.toString(),
      body: { referenceNumber: 'CMD-1001', amount: '2000', responsecode: '0' },
    });
    assert.equal(result.provider, 'xpaye');
    assert.equal(result.status, 'success');

    await assert.rejects(client.handleNotification({ url: '/notify', body: {} }), WebhookVerificationError);

    // Bascule : CinetPay reçoit une notify_url marquée cinetpay
    const fallbackClient = new PaymentClient({
      providers: [new XpayeProvider({ merchantId: 'PP-TEST', initUrl: `${down.url}/init` }), new CinetPayProvider({ apiKey: 'k', siteId: '1', apiUrl: cpSrv.url })],
    });
    await fallbackClient.createPayment({ ...baseRequest, channel: 'ORANGE_CI' });
    assert.equal(new URL(cpSrv.calls[0].body.notify_url).searchParams.get('provider'), 'cinetpay');
  } finally {
    down.close();
    cpSrv.close();
    xpSrv.close();
  }
});

function srvNotifyUrl(u) {
  return new URL(u);
}
