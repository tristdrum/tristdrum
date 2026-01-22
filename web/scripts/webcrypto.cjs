const crypto = require('crypto')

if (typeof crypto.getRandomValues !== 'function') {
  if (crypto.webcrypto && typeof crypto.webcrypto.getRandomValues === 'function') {
    crypto.getRandomValues = crypto.webcrypto.getRandomValues.bind(crypto.webcrypto)
  } else {
    crypto.getRandomValues = (array) => crypto.randomFillSync(array)
  }
}

if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
  if (crypto.webcrypto && typeof crypto.webcrypto.getRandomValues === 'function') {
    globalThis.crypto = crypto.webcrypto
  } else {
    globalThis.crypto = {
      getRandomValues: (array) => crypto.randomFillSync(array),
    }
  }
}
