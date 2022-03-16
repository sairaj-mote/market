//console.log(document.cookie.toString());
const INVALID_SERVER_MSG = "INCORRECT_SERVER_ERROR";
var nodeList, nodeURL, nodeKBucket; //Container for (backup) node list

function exchangeAPI(api, options) {
    return new Promise((resolve, reject) => {
        let curPos = exchangeAPI.curPos || 0;
        if (curPos >= nodeList.length)
            return resolve('No Nodes online');
        let url = "https://" + nodeURL[nodeList[curPos]];
        (options ? fetch(url + api, options) : fetch(url + api))
        .then(result => resolve(result)).catch(error => {
            console.warn(nodeList[curPos], 'is offline');
            //try next node
            exchangeAPI.curPos = curPos + 1;
            exchangeAPI(api, options)
                .then(result => resolve(result))
                .catch(error => reject(error))
        });
    })
}

function ResponseError(status, data) {
    if (data === INVALID_SERVER_MSG)
        location.reload();
    else if (this instanceof ResponseError) {
        this.data = data;
        this.status = status;
    } else
        return new ResponseError(status, data);
}

function responseParse(response, json_ = true) {
    return new Promise((resolve, reject) => {
        if (!response.ok)
            response.text()
            .then(result => reject(ResponseError(response.status, result)))
            .catch(error => reject(error));
        else if (json_)
            response.json()
            .then(result => resolve(result))
            .catch(error => reject(error));
        else
            response.text()
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
}

function getAccount(floID, proxySecret) {
    return new Promise((resolve, reject) => {
        let request = {
            floID: floID,
            timestamp: Date.now()
        };
        if (floCrypto.getFloID(proxySecret) === floID) //Direct signing (without proxy)
            request.pubKey = floCrypto.getPubKeyHex(proxySecret);
        request.sign = signRequest({
            type: "get_account",
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        exchangeAPI('/account', {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            }).then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function getBuyList() {
    return new Promise((resolve, reject) => {
        exchangeAPI('/list-buyorders')
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function getSellList() {
    return new Promise((resolve, reject) => {
        exchangeAPI('/list-sellorders')
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function getTradeList() {
    return new Promise((resolve, reject) => {
        exchangeAPI('/list-trades')
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function getRates(asset = null) {
    return new Promise((resolve, reject) => {
        exchangeAPI('/get-rates' + (asset ? "?asset=" + asset : ""))
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function getTx(txid) {
    return new Promise((resolve, reject) => {
        if (!txid)
            return reject('txid required');
        exchangeAPI('/get-transaction?txid=' + txid)
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    })
}

function signRequest(request, signKey) {
    if (typeof request !== "object")
        throw Error("Request is not an object");
    let req_str = Object.keys(request).sort().map(r => r + ":" + request[r]).join("|");
    return floCrypto.signData(req_str, signKey);
}

function getLoginCode() {
    return new Promise((resolve, reject) => {
        exchangeAPI('/get-login-code')
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    })
}

/*
function signUp(privKey, code, hash) {
    return new Promise((resolve, reject) => {
        if (!code || !hash)
            return reject("Login Code missing")
        let request = {
            pubKey: floCrypto.getPubKeyHex(privKey),
            floID: floCrypto.getFloID(privKey),
            code: code,
            hash: hash,
            timestamp: Date.now()
        };
        request.sign = signRequest({
            type: "create_account",
            random: code,
            timestamp: request.timestamp
        }, privKey);
        console.debug(request);

        exchangeAPI("/signup", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}
*/

function login(privKey, proxyKey, code, hash) {
    return new Promise((resolve, reject) => {
        if (!code || !hash)
            return reject("Login Code missing")
        let request = {
            proxyKey: proxyKey,
            floID: floCrypto.getFloID(privKey),
            pubKey: floCrypto.getPubKeyHex(privKey),
            timestamp: Date.now(),
            code: code,
            hash: hash
        };
        if (!privKey || !request.floID)
            return reject("Invalid Private key");
        request.sign = signRequest({
            type: "login",
            random: code,
            proxyKey: proxyKey,
            timestamp: request.timestamp
        }, privKey);
        console.debug(request);

        exchangeAPI("/login", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    })
}

function logout(floID, proxySecret) {
    return new Promise((resolve, reject) => {
        let request = {
            floID: floID,
            timestamp: Date.now()
        };
        if (floCrypto.getFloID(proxySecret) === floID) //Direct signing (without proxy)
            request.pubKey = floCrypto.getPubKeyHex(proxySecret);
        request.sign = signRequest({
            type: "logout",
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        exchangeAPI("/logout", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })
}

function buy(asset, quantity, max_price, floID, proxySecret) {
    return new Promise((resolve, reject) => {
        if (typeof quantity !== "number" || quantity <= 0)
            return reject(`Invalid quantity (${quantity})`);
        else if (typeof max_price !== "number" || max_price <= 0)
            return reject(`Invalid max_price (${max_price})`);
        let request = {
            floID: floID,
            asset: asset,
            quantity: quantity,
            max_price: max_price,
            timestamp: Date.now()
        };
        if (floCrypto.getFloID(proxySecret) === floID) //Direct signing (without proxy)
            request.pubKey = floCrypto.getPubKeyHex(proxySecret);
        request.sign = signRequest({
            type: "buy_order",
            asset: asset,
            quantity: quantity,
            max_price: max_price,
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        exchangeAPI('/buy', {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })

}

function sell(asset, quantity, min_price, floID, proxySecret) {
    return new Promise((resolve, reject) => {
        if (typeof quantity !== "number" || quantity <= 0)
            return reject(`Invalid quantity (${quantity})`);
        else if (typeof min_price !== "number" || min_price <= 0)
            return reject(`Invalid min_price (${min_price})`);
        let request = {
            floID: floID,
            asset: asset,
            quantity: quantity,
            min_price: min_price,
            timestamp: Date.now()
        };
        if (floCrypto.getFloID(proxySecret) === floID) //Direct signing (without proxy)
            request.pubKey = floCrypto.getPubKeyHex(proxySecret);
        request.sign = signRequest({
            type: "sell_order",
            quantity: quantity,
            asset: asset,
            min_price: min_price,
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        exchangeAPI('/sell', {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })

}

function cancelOrder(type, id, floID, proxySecret) {
    return new Promise((resolve, reject) => {
        if (type !== "buy" && type !== "sell")
            return reject(`Invalid type (${type}): type should be sell (or) buy`);
        let request = {
            floID: floID,
            orderType: type,
            orderID: id,
            timestamp: Date.now()
        };
        if (floCrypto.getFloID(proxySecret) === floID) //Direct signing (without proxy)
            request.pubKey = floCrypto.getPubKeyHex(proxySecret);
        request.sign = signRequest({
            type: "cancel_order",
            order: type,
            id: id,
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        exchangeAPI('/cancel', {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })
}

//receiver should be object eg {floID1: amount1, floID2: amount2 ...}
function transferToken(receiver, token, floID, proxySecret) {
    return new Promise((resolve, reject) => {
        if (typeof receiver !== 'object' || receiver === null)
            return reject("Invalid receiver: parameter is not an object");
        let invalidIDs = [],
            invalidAmt = [];
        for (let f in receiver) {
            if (!floCrypto.validateAddr(f))
                invalidIDs.push(f);
            else if (typeof receiver[f] !== "number" || receiver[f] <= 0)
                invalidAmt.push(receiver[f])
        }
        if (invalidIDs.length)
            return reject(INVALID(`Invalid receiver (${invalidIDs})`));
        else if (invalidAmt.length)
            return reject(`Invalid amount (${invalidAmt})`);
        let request = {
            floID: floID,
            token: token,
            receiver: receiver,
            timestamp: Date.now()
        };
        if (floCrypto.getFloID(proxySecret) === floID) //Direct signing (without proxy)
            request.pubKey = floCrypto.getPubKeyHex(proxySecret);
        request.sign = signRequest({
            type: "transfer_token",
            receiver: JSON.stringify(receiver),
            token: token,
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        exchangeAPI('/transfer-token', {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })
}

function depositFLO(quantity, floID, sinkID, privKey, proxySecret = null) {
    return new Promise((resolve, reject) => {
        if (typeof quantity !== "number" || quantity <= floGlobals.fee)
            return reject(`Invalid quantity (${quantity})`);
        floBlockchainAPI.sendTx(floID, sinkID, quantity, privKey, 'Deposit FLO in market').then(txid => {
            let request = {
                floID: floID,
                txid: txid,
                timestamp: Date.now()
            };
            if (!proxySecret) //Direct signing (without proxy)
                request.pubKey = floCrypto.getPubKeyHex(privKey);
            request.sign = signRequest({
                type: "deposit_flo",
                txid: txid,
                timestamp: request.timestamp
            }, proxySecret || privKey);
            console.debug(request);

            exchangeAPI('/deposit-flo', {
                    method: "POST",
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(request)
                }).then(result => responseParse(result, false)
                    .then(result => resolve(result))
                    .catch(error => reject(error)))
                .catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function withdrawFLO(quantity, floID, proxySecret) {
    return new Promise((resolve, reject) => {
        let request = {
            floID: floID,
            amount: quantity,
            timestamp: Date.now()
        };
        if (floCrypto.getFloID(proxySecret) === floID) //Direct signing (without proxy)
            request.pubKey = floCrypto.getPubKeyHex(proxySecret);
        request.sign = signRequest({
            type: "withdraw_flo",
            amount: quantity,
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        exchangeAPI('/withdraw-flo', {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })
}

function depositToken(token, quantity, floID, sinkID, privKey, proxySecret = null) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.verifyPrivKey(privKey, floID))
            return reject("Invalid Private Key");
        tokenAPI.sendToken(privKey, quantity, sinkID, 'Deposit Rupee in market', token).then(txid => {
            let request = {
                floID: floID,
                txid: txid,
                timestamp: Date.now()
            };
            if (!proxySecret) //Direct signing (without proxy)
                request.pubKey = floCrypto.getPubKeyHex(privKey);
            request.sign = signRequest({
                type: "deposit_token",
                txid: txid,
                timestamp: request.timestamp
            }, proxySecret || privKey);
            console.debug(request);

            exchangeAPI('/deposit-token', {
                    method: "POST",
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(request)
                }).then(result => responseParse(result, false)
                    .then(result => resolve(result))
                    .catch(error => reject(error)))
                .catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function withdrawToken(token, quantity, floID, proxySecret) {
    return new Promise((resolve, reject) => {
        let request = {
            floID: floID,
            token: token,
            amount: quantity,
            timestamp: Date.now()
        };
        if (floCrypto.getFloID(proxySecret) === floID) //Direct signing (without proxy)
            request.pubKey = floCrypto.getPubKeyHex(proxySecret);
        request.sign = signRequest({
            type: "withdraw_token",
            token: token,
            amount: quantity,
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        exchangeAPI('/withdraw-token', {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })
}

function addUserTag(tag_user, tag, floID, proxySecret) {
    return new Promise((resolve, reject) => {
        let request = {
            floID: floID,
            user: tag_user,
            tag: tag,
            timestamp: Date.now()
        };
        if (floCrypto.getFloID(proxySecret) === floID) //Direct signing (without proxy)
            request.pubKey = floCrypto.getPubKeyHex(proxySecret);
        request.sign = signRequest({
            type: "add_tag",
            user: tag_user,
            tag: tag,
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        exchangeAPI('/add-tag', {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })
}

function removeUserTag(tag_user, tag, floID, proxySecret) {
    return new Promise((resolve, reject) => {
        let request = {
            floID: floID,
            user: tag_user,
            tag: tag,
            timestamp: Date.now()
        };
        if (floCrypto.getFloID(proxySecret) === floID) //Direct signing (without proxy)
            request.pubKey = floCrypto.getPubKeyHex(proxySecret);
        request.sign = signRequest({
            type: "remove_tag",
            user: tag_user,
            tag: tag,
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        exchangeAPI('/remove-tag', {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(request)
            }).then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })
}

function refreshDataFromBlockchain() {
    return new Promise((resolve, reject) => {
        let nodes, lastTx;
        try {
            nodes = JSON.parse(localStorage.getItem('exchange-nodes'));
            if (typeof nodes !== 'object' || nodes === null)
                throw Error('nodes must be an object')
            else
                lastTx = parseInt(localStorage.getItem('exchange-lastTx')) || 0;
        } catch (error) {
            nodes = {};
            lastTx = 0;
        }
        floBlockchainAPI.readData(floGlobals.adminID, {
            ignoreOld: lastTx,
            sentOnly: true,
            pattern: floGlobals.application
        }).then(result => {
            result.data.reverse().forEach(data => {
                var content = JSON.parse(data)[floGlobals.application];
                //Node List
                if (content.Nodes) {
                    if (content.Nodes.remove)
                        for (let n of content.Nodes.remove)
                            delete nodes[n];
                    if (content.Nodes.add)
                        for (let n in content.Nodes.add)
                            nodes[n] = content.Nodes.add[n];
                }
            });
            localStorage.setItem('exchange-lastTx', result.totalTxs);
            localStorage.setItem('exchange-nodes', JSON.stringify(nodes));
            nodeURL = nodes;
            nodeKBucket = new K_Bucket(floGlobals.adminID, Object.keys(nodeURL));
            nodeList = nodeKBucket.order;
            resolve(nodes);
        }).catch(error => reject(error));
    })
}