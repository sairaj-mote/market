//console.log(document.cookie.toString());
const INVALID_SERVER_MSG = "INCORRECT_SERVER_ERROR";
var nodeList, nodeURL, nodeKBucket; //Container for (backup) node list

function exchangeAPI(api, options) {
    return new Promise((resolve, reject) => {
        let curPos = exchangeAPI.curPos || 0;
        if (curPos >= nodeList.length)
            return resolve('No Nodes online');
        let url = "http://" + nodeURL[nodeList[curPos]];
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

const tokenAPI = {
    fetch_api: function(apicall) {
        return new Promise((resolve, reject) => {
            console.log(floGlobals.tokenURL + apicall);
            fetch(floGlobals.tokenURL + apicall).then(response => {
                if (response.ok)
                    response.json().then(data => resolve(data));
                else
                    reject(response)
            }).catch(error => reject(error))
        })
    },
    getBalance: function(floID, token = 'rupee') {
        return new Promise((resolve, reject) => {
            this.fetch_api(`api/v1.0/getFloAddressBalance?token=${token}&floAddress=${floID}`)
                .then(result => resolve(result.balance || 0))
                .catch(error => reject(error))
        })
    },
    getTx: function(txID) {
        return new Promise((resolve, reject) => {
            this.fetch_api(`api/v1.0/getTransactionDetails/${txID}`).then(res => {
                if (res.result === "error")
                    reject(res.description);
                else if (!res.parsedFloData)
                    reject("Data piece (parsedFloData) missing");
                else if (!res.transactionDetails)
                    reject("Data piece (transactionDetails) missing");
                else
                    resolve(res);
            }).catch(error => reject(error))
        })
    },
    sendToken: function(privKey, amount, receiverID, message = "", token = floGlobals.currency) {
        return new Promise((resolve, reject) => {
            let senderID = floCrypto.getFloID(privKey);
            if (typeof amount !== "number" || amount <= 0)
                return reject("Invalid amount");
            this.getBalance(senderID, token).then(bal => {
                if (amount > bal)
                    return reject("Insufficiant token balance");
                floBlockchainAPI.writeData(senderID, `send ${amount} ${token}# ${message}`, privKey, receiverID)
                    .then(txid => resolve(txid))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        });
    }
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

function getTransactionList() {
    return new Promise((resolve, reject) => {
        exchangeAPI('/list-transactions')
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function getRates() {
    return new Promise((resolve, reject) => {
        exchangeAPI('/get-rates')
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function signRequest(request, privKey) {
    if (typeof request !== "object")
        throw Error("Request is not an object");
    let req_str = Object.keys(request).sort().map(r => r + ":" + request[r]).join("|");
    return floCrypto.signData(req_str, privKey);
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

function login(privKey, proxyKey, code, hash) {
    return new Promise((resolve, reject) => {
        if (!code || !hash)
            return reject("Login Code missing")
        let request = {
            proxyKey: proxyKey,
            floID: floCrypto.getFloID(privKey),
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

function depositFLO(quantity, floID, sinkID, privKey, proxySecret) {
    return new Promise((resolve, reject) => {
        if (typeof quantity !== "number" || quantity <= floGlobals.fee)
            return reject(`Invalid quantity (${quantity})`);
        floBlockchainAPI.sendTx(floID, sinkID, quantity, privKey, 'Deposit FLO in market').then(txid => {
            let request = {
                floID: floID,
                txid: txid,
                timestamp: Date.now()
            };
            request.sign = signRequest({
                type: "deposit_FLO",
                txid: txid,
                timestamp: request.timestamp
            }, proxySecret);
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
        request.sign = signRequest({
            type: "withdraw_FLO",
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

function depositToken(token, quantity, floID, sinkID, privKey, proxySecret) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.verifyPrivKey(privKey, floID))
            return reject("Invalid Private Key");
        tokenAPI.sendToken(privKey, quantity, sinkID, 'Deposit Rupee in market', token).then(txid => {
            let request = {
                floID: floID,
                txid: txid,
                timestamp: Date.now()
            };
            request.sign = signRequest({
                type: "deposit_Token",
                txid: txid,
                timestamp: request.timestamp
            }, proxySecret);
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
        request.sign = signRequest({
            type: "withdraw_Token",
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
        request.sign = signRequest({
            command: "add_Tag",
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
        request.sign = signRequest({
            command: "remove_Tag",
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