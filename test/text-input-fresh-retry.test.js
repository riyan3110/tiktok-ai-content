const test = require('node:test');
const assert = require('node:assert/strict');
const patch = require('../src/services/autoSourcePatch');

test('Generate dari Teks fresh-retries once after exhausted validation repairs', async () => {
  const client = { id: 'same-client' };
  let calls = 0;
  const composer = {
    compose: async ({ text, client: receivedClient }) => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('first validation cycle failed'), {
          status: 422,
          validationErrors: ['slide 1 duplicate']
        });
      }
      return { ok: true, text, client: receivedClient };
    }
  };

  const result = await patch.composeTextInputWithFreshRetry({
    text: 'Ringkasan berita asli yang dipakai kembali dari nol.',
    client,
    composer
  });

  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  assert.equal(result.text, 'Ringkasan berita asli yang dipakai kembali dari nol.');
  assert.strictEqual(result.client, client);
});

test('fresh retry happens at most once', async () => {
  let calls = 0;
  const composer = {
    compose: async () => {
      calls += 1;
      throw Object.assign(new Error(`validation failure ${calls}`), {
        status: 422,
        validationErrors: ['layout still invalid']
      });
    }
  };

  await assert.rejects(
    () => patch.composeTextInputWithFreshRetry({ text: 'Teks asli', composer }),
    error => error.message === 'validation failure 2'
  );
  assert.equal(calls, 2);
});

test('input validation and non-validation errors are not fresh-retried', async () => {
  for (const failure of [
    Object.assign(new Error('text too short'), { status: 422 }),
    Object.assign(new Error('provider auth failed'), { status: 401 })
  ]) {
    let calls = 0;
    const composer = {
      compose: async () => {
        calls += 1;
        throw failure;
      }
    };

    await assert.rejects(
      () => patch.composeTextInputWithFreshRetry({ text: 'Teks asli', composer }),
      error => error === failure
    );
    assert.equal(calls, 1);
  }
});
