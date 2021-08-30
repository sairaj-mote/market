'use strict';

(function(GLOBAL) {
    var floCrypto = GLOBAL.floCrypto = {};
    const p = BigInteger("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F", 16);
    const ecparams = EllipticCurve.getSECCurveByName("secp256k1");

    function exponent1() {
        return p.add(BigInteger.ONE).divide(BigInteger("4"));
    };

    function calculateY(x) {
        let exp = exponent1();
        // x is x value of public key in BigInteger format without 02 or 03 or 04 prefix
        return x.modPow(BigInteger("3"), p).add(BigInteger("7")).mod(p).modPow(exp, p);
    };

    function getUncompressedPublicKey(compressedPublicKey) {
        // Fetch x from compressedPublicKey
        let pubKeyBytes = Crypto.util.hexToBytes(compressedPublicKey);
        const prefix = pubKeyBytes.shift(); // remove prefix
        let prefix_modulus = prefix % 2;
        pubKeyBytes.unshift(0); // add prefix 0
        let x = new BigInteger(pubKeyBytes);
        let xDecimalValue = x.toString();
        // Fetch y
        let y = calculateY(x);
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
    };

    function getSenderPublicKeyString() {
        privateKey = ellipticCurveEncryption.senderRandom();
        senderPublicKeyString = ellipticCurveEncryption.senderPublicString(privateKey);
        return {
            privateKey: privateKey,
            senderPublicKeyString: senderPublicKeyString
        };
    };

    function deriveSharedKeySender(receiverCompressedPublicKey, senderPrivateKey) {
        try {
            let receiverPublicKeyString = getUncompressedPublicKey(receiverCompressedPublicKey);
            var senderDerivedKey = ellipticCurveEncryption.senderSharedKeyDerivation(
                receiverPublicKeyString.x, receiverPublicKeyString.y, senderPrivateKey);
            return senderDerivedKey;
        } catch (error) {
            return new Error(error);
        };
    };

    function deriveReceiverSharedKey(senderPublicKeyString, receiverPrivateKey) {
        return ellipticCurveEncryption.receiverSharedKeyDerivation(
            senderPublicKeyString.XValuePublicString,
            senderPublicKeyString.YValuePublicString, receiverPrivateKey);
    };

    function getReceiverPublicKeyString(privateKey) {
        return ellipticCurveEncryption.receiverPublicString(privateKey);
    };

    function wifToDecimal(pk_wif, isPubKeyCompressed = false) {
        let pk = Bitcoin.Base58.decode(pk_wif);
        pk.shift();
        pk.splice(-4, 4);
        //If the private key corresponded to a compressed public key, also drop the last byte (it should be 0x01).
        if (isPubKeyCompressed == true) pk.pop();
        pk.unshift(0);
        privateKeyDecimal = BigInteger(pk).toString();
        privateKeyHex = Crypto.util.bytesToHex(pk);
        return {
            privateKeyDecimal: privateKeyDecimal,
            privateKeyHex: privateKeyHex
        };
    };


    //generate a random Interger within range
    floCrypto.randInt = function(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1)) + min;
    };

    //generate a random String within length (options : alphaNumeric chars only)
    floCrypto.randString = function(length, alphaNumeric = true) {
        var result = '';
        if (alphaNumeric)
            var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        else
            var characters =
                'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+-./*?@#&$<>=[]{}():';
        for (var i = 0; i < length; i++)
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        return result;
    };

    //Encrypt Data using public-key
    floCrypto.encryptData = function(data, publicKeyHex) {
        var senderECKeyData = getSenderPublicKeyString();
        var senderDerivedKey = deriveSharedKeySender(
            publicKeyHex, senderECKeyData.privateKey);
        let senderKey = senderDerivedKey.XValue + senderDerivedKey.YValue;
        let secret = Crypto.AES.encrypt(data, senderKey);
        return {
            secret: secret,
            senderPublicKeyString: senderECKeyData.senderPublicKeyString
        };
    };

    //Decrypt Data using private-key
    floCrypto.decryptData = function(data, privateKeyHex) {
        var receiverECKeyData = {};
        if (typeof privateKeyHex !== "string") throw new Error("No private key found.");
        let privateKey = wifToDecimal(privateKeyHex, true);
        if (typeof privateKey.privateKeyDecimal !== "string") throw new Error(
            "Failed to detremine your private key.");
        receiverECKeyData.privateKey = privateKey.privateKeyDecimal;
        var receiverDerivedKey = deriveReceiverSharedKey(
            data.senderPublicKeyString, receiverECKeyData.privateKey);
        let receiverKey = receiverDerivedKey.XValue + receiverDerivedKey.YValue;
        let decryptMsg = Crypto.AES.decrypt(data.secret, receiverKey);
        return decryptMsg;
    };

    //Sign data using private-key
    floCrypto.signData = function(data, privateKeyHex) {
        var key = new Bitcoin.ECKey(privateKeyHex);
        if(key.priv === null)
            return false;
        key.setCompressed(true);
        //var privateKeyArr = key.getBitcoinPrivateKeyByteArray();
        //var privateKey = BigInteger.fromByteArrayUnsigned(privateKeyArr);
        var messageHash = Crypto.SHA256(data);
        var messageHashBigInteger = new BigInteger(messageHash);
        var messageSign = Bitcoin.ECDSA.sign(messageHashBigInteger, key.priv);
        var sighex = Crypto.util.bytesToHex(messageSign);
        return sighex;
    };

    //Verify signatue of the data using public-key
    floCrypto.verifySign = function(data, signatureHex, publicKeyHex) {
        var msgHash = Crypto.SHA256(data);
        var messageHashBigInteger = new BigInteger(msgHash);
        var sigBytes = Crypto.util.hexToBytes(signatureHex);
        var signature = Bitcoin.ECDSA.parseSig(sigBytes);
        var publicKeyPoint = ecparams.getCurve().decodePointHex(publicKeyHex);
        var verify = Bitcoin.ECDSA.verifyRaw(messageHashBigInteger,
            signature.r, signature.s, publicKeyPoint);
        return verify;
    };

    //Generates a new flo ID and returns private-key, public-key and floID
    floCrypto.generateNewID = function() {
        try {
            var key = new Bitcoin.ECKey(false);
            key.setCompressed(true);
            return {
                floID: key.getBitcoinAddress(),
                pubKey: key.getPubKeyHex(),
                privKey: key.getBitcoinWalletImportFormat()
            };
        } catch (e) {
            console.error(e);
        };
    };

    //Returns public-key from private-key
    floCrypto.getPubKeyHex = function(privateKeyHex) {
        if (!privateKeyHex)
            return null;
        var key = new Bitcoin.ECKey(privateKeyHex);
        if (key.priv == null)
            return null;
        key.setCompressed(true);
        return key.getPubKeyHex();
    };

    //Returns flo-ID from public-key or private-key
    floCrypto.getFloID = function(keyHex) {
        if (!keyHex)
            return null;
        try {
            var key = new Bitcoin.ECKey(keyHex);
            if (key.priv == null)
                key.setPub(keyHex);
            return key.getBitcoinAddress();
        } catch (e) {
            return null;
        };
    };

    //Verify the private-key for the given public-key or flo-ID
    floCrypto.verifyPrivKey = function(privateKeyHex, publicHex_ID) {
        if (!privateKeyHex || !publicHex_ID)
            return false;
        try {
            var key = new Bitcoin.ECKey(privateKeyHex);
            if (key.priv == null)
                return false;
            key.setCompressed(true);
            if (publicHex_ID === key.getBitcoinAddress())
                return true;
            else if (publicHex_ID === key.getPubKeyHex())
                return true;
            else
                return false;
        } catch (e) {
            console.error(e);
        };
    };

    //Check if the given Address is valid or not
    floCrypto.validateAddr = function(inpAddr) {
        if (!inpAddr)
            return false;
        try {
            var addr = new Bitcoin.Address(inpAddr);
            return true;
        } catch {
            return false;
        };
    };

    //Split the str using shamir's Secret and Returns the shares 
    floCrypto.createShamirsSecretShares = function(str, total_shares, threshold_limit) {
        try {
            if (str.length > 0) {
                var strHex = shamirSecretShare.str2hex(str);
                return shamirSecretShare.share(strHex, total_shares, threshold_limit);
            };
            return false;
        } catch {
            return false;
        };
    };

    //Verifies the shares and str
    floCrypto.verifyShamirsSecret = function(sharesArray, str) {
        if(str == false)
            return false;
        try {
            if (sharesArray.length > 0) {
                var comb = shamirSecretShare.combine(sharesArray.slice(0, sharesArray.length));
                return (shamirSecretShare.hex2str(comb) === str ? true : false);
            };
            return false;
        } catch {
            return false;
        };
    };

    //Returns the retrived secret by combining the shamirs shares
    floCrypto.retrieveShamirSecret = function(sharesArray) {
        try {
            if (sharesArray.length > 0) {
                var comb = shamirSecretShare.combine(sharesArray.slice(0, sharesArray.length));
                return shamirSecretShare.hex2str(comb);
            };
            return false;
        } catch {
            return false;
        };
    };

})(typeof global !== "undefined" ? global : window);