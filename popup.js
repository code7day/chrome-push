const fields = ['baseUrl', 'appId', 'publicKey', 'userId'];
const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };

chrome.storage.local.get(fields, (c) => {
  for (const f of fields) $(f).value = c[f] || '';
});

const save = () => chrome.storage.local.set(Object.fromEntries(fields.map((f) => [f, $(f).value.trim()])));

const call = async (type) => {
  await save();
  status('Procesando...');
  chrome.runtime.sendMessage({ type }, (r) => {
    if (chrome.runtime.lastError) return status(chrome.runtime.lastError.message);
    status(r.ok ? (type === 'subscribe' ? 'Suscrito: ' + r.endpoint.slice(0, 50) + '...' : 'Suscripción cancelada') : 'Error: ' + r.error);
  });
};

$('sub').onclick = () => call('subscribe');
$('unsub').onclick = () => call('unsubscribe');
