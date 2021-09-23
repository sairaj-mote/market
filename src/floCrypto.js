'use strict';

(function(GLOBAL) {
    const floCrypto = GLOBAL.floCrypto = {

        util: {
            p: BigInteger("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F", 16),

            ecparams: EllipticCurve.getSECCurveByName("secp256k1"),

            asciiAlternatives: `‘ '\n’ '\n“ "\n” "\n– --\n— ---\n≥ >=\n≤ <=\n≠ !=\n× *\n÷ /\n← <-\n→ ->\n↔ <->\n⇒ =>\n⇐ <=\n⇔ <=>`,

            exponent1: function() {
                return this.p.add(BigInteger.ONE).divide(BigInteger("4"))
            },

            calculateY: function(x) {
                let p = this.p;
                let exp = this.exponent1();
                // x is x value of public key in BigInteger format without 02 or 03 or 04 prefix
                return x.modPow(BigInteger("3"), p).add(BigInteger("7")).mod(p).modPow(exp, p)
            },
            getUncompressedPublicKey: function(compressedPublicKey) {
                const p = this.p;
                // Fetch x from compressedPublicKey
                let pubKeyBytes = Crypto.util.hexToBytes(compressedPublicKey);
                const prefix = pubKeyBytes.shift() // remove prefix
                let prefix_modulus = prefix % 2;
                pubKeyBytes.unshift(0) // add prefix 0
                let x = new BigInteger(pubKeyBytes)
                let xDecimalValue = x.toString()
                // Fetch y
                let y = this.calculateY(x);
                let yDecimalValue = y.toString();
                // verify y value
                let resultBigInt = y.mod(BigInteger("2"));
                let check = resultBigInt.toString() % 2;
                if (prefix_modulus !== check)
                    yDecimalValue = y.negate().mod(p).toString();
                return {
                    x: xDecimalValue,
                    y: yDecimalValue
                };
            },

            getSenderPublicKeyString: function() {
                privateKey = ellipticCurveEncryption.senderRandom();
                senderPublicKeyString = ellipticCurveEncryption.senderPublicString(privateKey);
                return {
                    privateKey: privateKey,
                    senderPublicKeyString: senderPublicKeyString
                }
            },

            deriveSharedKeySender: function(receiverCompressedPublicKey, senderPrivateKey) {
                let receiverPublicKeyString = this.getUncompressedPublicKey(receiverCompressedPublicKey);
                var senderDerivedKey = ellipticCurveEncryption.senderSharedKeyDerivation(
                    receiverPublicKeyString.x, receiverPublicKeyString.y, senderPrivateKey);
                return senderDerivedKey;
            },

            deriveReceiverSharedKey: function(senderPublicKeyString, receiverPrivateKey) {
                return ellipticCurveEncryption.receiverSharedKeyDerivation(
                    senderPublicKeyString.XValuePublicString, senderPublicKeyString.YValuePublicString, receiverPrivateKey);
            },

            getReceiverPublicKeyString: function(privateKey) {
                return ellipticCurveEncryption.receiverPublicString(privateKey);
            },

            deriveSharedKeyReceiver: function(senderPublicKeyString, receiverPrivateKey) {
                return ellipticCurveEncryption.receiverSharedKeyDerivation(
                    senderPublicKeyString.XValuePublicString, senderPublicKeyString.YValuePublicString, receiverPrivateKey);
            },

            wifToDecimal: function(pk_wif, isPubKeyCompressed = false) {
                let pk = Bitcoin.Base58.decode(pk_wif)
                pk.shift()
                pk.splice(-4, 4)
                //If the private key corresponded to a compressed public key, also drop the last byte (it should be 0x01).
                if (isPubKeyCompressed == true) pk.pop()
                pk.unshift(0)
                privateKeyDecimal = BigInteger(pk).toString()
                privateKeyHex = Crypto.util.bytesToHex(pk)
                return {
                    privateKeyDecimal: privateKeyDecimal,
                    privateKeyHex: privateKeyHex
                }
            }
        },

        //generate a random Interger within range
        randInt: function(min, max) {
            min = Math.ceil(min);
            max = Math.floor(max);
            return Math.floor(Math.random() * (max - min + 1)) + min;
        },

        //generate a random String within length (options : alphaNumeric chars only)
        randString: function(length, alphaNumeric = true) {
            var result = '';
            if (alphaNumeric)
                var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            else
                var characters =
                    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+-./*?@#&$<>=[]{}():';
            for (var i = 0; i < length; i++)
                result += characters.charAt(Math.floor(Math.random() * characters.length));
            return result;
        },

        //Encrypt Data using public-key
        encryptData: function(data, receiverCompressedPublicKey) {
            var senderECKeyData = this.util.getSenderPublicKeyString();
            var senderDerivedKey = this.util.deriveSharedKeySender(receiverCompressedPublicKey, senderECKeyData
                .privateKey);
            let senderKey = senderDerivedKey.XValue + senderDerivedKey.YValue;
            let secret = Crypto.AES.encrypt(data, senderKey);
            return {
                secret: secret,
                senderPublicKeyString: senderECKeyData.senderPublicKeyString
            };
        },

        //Decrypt Data using private-key
        decryptData: function(data, myPrivateKey) {
            var receiverECKeyData = {};
            if (typeof myPrivateKey !== "string") throw new Error("No private key found.");

            let privateKey = this.util.wifToDecimal(myPrivateKey, true);
            if (typeof privateKey.privateKeyDecimal !== "string") throw new Error(
                "Failed to detremine your private key.");
            receiverECKeyData.privateKey = privateKey.privateKeyDecimal;

            var receiverDerivedKey = this.util.deriveReceiverSharedKey(data.senderPublicKeyString,
                receiverECKeyData
                .privateKey);

            let receiverKey = receiverDerivedKey.XValue + receiverDerivedKey.YValue;
            let decryptMsg = Crypto.AES.decrypt(data.secret, receiverKey);
            return decryptMsg;
        },

        //Sign data using private-key
        signData: function(data, privateKeyHex) {
            var key = new Bitcoin.ECKey(privateKeyHex);
            key.setCompressed(true);

            var privateKeyArr = key.getBitcoinPrivateKeyByteArray();
            privateKey = BigInteger.fromByteArrayUnsigned(privateKeyArr);
            var messageHash = Crypto.SHA256(data);

            var messageHashBigInteger = new BigInteger(messageHash);
            var messageSign = Bitcoin.ECDSA.sign(messageHashBigInteger, key.priv);

            var sighex = Crypto.util.bytesToHex(messageSign);
            return sighex;
        },

        //Verify signatue of the data using public-key
        verifySign: function(data, signatureHex, publicKeyHex) {
            var msgHash = Crypto.SHA256(data);
            var messageHashBigInteger = new BigInteger(msgHash);

            var sigBytes = Crypto.util.hexToBytes(signatureHex);
            var signature = Bitcoin.ECDSA.parseSig(sigBytes);

            var publicKeyPoint = this.util.ecparams.getCurve().decodePointHex(publicKeyHex);

            var verify = Bitcoin.ECDSA.verifyRaw(messageHashBigInteger, signature.r, signature.s,
                publicKeyPoint);
            return verify;
        },

        //Generates a new flo ID and returns private-key, public-key and floID
        generateNewID: function() {
            try {
                var key = new Bitcoin.ECKey(false);
                key.setCompressed(true);
                return {
                    floID: key.getBitcoinAddress(),
                    pubKey: key.getPubKeyHex(),
                    privKey: key.getBitcoinWalletImportFormat()
                }
            } catch (e) {
                console.error(e);
            }
        },

        //Returns public-key from private-key
        getPubKeyHex: function(privateKeyHex) {
            if (!privateKeyHex)
                return null;
            var key = new Bitcoin.ECKey(privateKeyHex);
            if (key.priv == null)
                return null;
            key.setCompressed(true);
            return key.getPubKeyHex();
        },

        //Returns flo-ID from public-key or private-key
        getFloID: function(keyHex) {
            if (!keyHex)
                return null;
            try {
                var key = new Bitcoin.ECKey(keyHex);
                if (key.priv == null)
                    key.setPub(keyHex);
                return key.getBitcoinAddress();
            } catch (e) {
                return null;
            }
        },

        //Verify the private-key for the given public-key or flo-ID
        verifyPrivKey: function(privateKeyHex, pubKey_floID, isfloID = true) {
            if (!privateKeyHex || !pubKey_floID)
                return false;
            try {
                var key = new Bitcoin.ECKey(privateKeyHex);
                if (key.priv == null)
                    return false;
                key.setCompressed(true);
                if (isfloID && pubKey_floID == key.getBitcoinAddress())
                    return true;
                else if (!isfloID && pubKey_floID == key.getPubKeyHex())
                    return true;
                else
                    return false;
            } catch (e) {
                console.error(e);
            }
        },

        //Check if the given Address is valid or not
        validateAddr: function(inpAddr) {
            if (!inpAddr)
                return false;
            try {
                var addr = new Bitcoin.Address(inpAddr);
                return true;
            } catch {
                return false;
            }
        },

        //Split the str using shamir's Secret and Returns the shares 
        createShamirsSecretShares: function(str, total_shares, threshold_limit) {
            try {
                if (str.length > 0) {
                    var strHex = shamirSecretShare.str2hex(str);
                    var shares = shamirSecretShare.share(strHex, total_shares, threshold_limit);
                    return shares;
                }
                return false;
            } catch {
                return false
            }
        },

        //Verifies the shares and str
        verifyShamirsSecret: function(sharesArray, str) {
            return (str && this.retrieveShamirSecret(sharesArray) === str)
        },

        //Returns the retrived secret by combining the shamirs shares
        retrieveShamirSecret: function(sharesArray) {
            try {
                if (sharesArray.length > 0) {
                    var comb = shamirSecretShare.combine(sharesArray.slice(0, sharesArray.length));
                    comb = shamirSecretShare.hex2str(comb);
                    return comb;
                }
                return false;
            } catch {
                return false;
            }
        },

        validateASCII: function(string, bool = true) {
            if (typeof string !== "string")
                return null;
            if (bool) {
                let x;
                for (let i = 0; i < string.length; i++) {
                    x = string.charCodeAt(i);
                    if (x < 32 || x > 127)
                        return false;
                }
                return true;
            } else {
                let x, invalids = {};
                for (let i = 0; i < string.length; i++) {
                    x = string.charCodeAt(i);
                    if (x < 32 || x > 127)
                        if (x in invalids)
                            invalids[string[i]].push(i)
                    else
                        invalids[string[i]] = [i];
                }
                if (Object.keys(invalids).length)
                    return invalids;
                else
                    return true;
            }
        },

        convertToASCII: function(string, mode = 'soft-remove') {
            let chars = this.validateASCII(string, false);
            if (chars === true)
                return string;
            else if (chars === null)
                return null;
            let convertor, result = string,
                refAlt = {};
            this.util.asciiAlternatives.split('\n').forEach(a => refAlt[a[0]] = a.slice(2));
            mode = mode.toLowerCase();
            if (mode === "hard-unicode")
                convertor = (c) => `\\u${('000'+c.charCodeAt().toString(16)).slice(-4)}`;
            else if (mode === "soft-unicode")
                convertor = (c) => refAlt[c] || `\\u${('000'+c.charCodeAt().toString(16)).slice(-4)}`;
            else if (mode === "hard-remove")
                convertor = c => "";
            else if (mode === "soft-remove")
                convertor = c => refAlt[c] || "";
            else
                return null;
            for (let c in chars)
                result = result.replaceAll(c, convertor(c));
            return result;
        },

        revertUnicode: function(string) {
            return string.replace(/\\u[\dA-F]{4}/gi,
                m => String.fromCharCode(parseInt(m.replace(/\\u/g, ''), 16)));
        }
    }

})(typeof global !== "undefined" ? global : window);