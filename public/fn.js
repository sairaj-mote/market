//console.log(document.cookie.toString());

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
    sendToken: function(privKey, amount, message = "", receiverID = floGlobals.adminID, token = 'rupee') {
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
    if (this instanceof ResponseError) {
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

function getAccount() {
    return new Promise((resolve, reject) => {
        fetch('/account')
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function getBuyList() {
    return new Promise((resolve, reject) => {
        fetch('/list-buyorders')
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function getSellList() {
    return new Promise((resolve, reject) => {
        fetch('/list-sellorders')
            .then(result => responseParse(result)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error));
    });
}

function getTransactionList() {
    return new Promise((resolve, reject) => {
        fetch('/list-transactions')
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

function signUp(privKey, sid) {
    return new Promise((resolve, reject) => {
        let request = {
            pubKey: floCrypto.getPubKeyHex(privKey),
            floID: floCrypto.getFloID(privKey),
            timestamp: Date.now()
        };
        request.sign = signRequest({
            type: "create_account",
            random: sid,
            timestamp: request.timestamp
        }, privKey);
        console.debug(request);

        fetch("/signup", {
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

function login(privKey, proxyKey, sid, rememberMe = false) {
    return new Promise((resolve, reject) => {
        let request = {
            proxyKey: proxyKey,
            floID: floCrypto.getFloID(privKey),
            timestamp: Date.now(),
            saveSession: rememberMe
        };
        if (!privKey || !request.floID)
            return reject("Invalid Private key");
        request.sign = signRequest({
            type: "login",
            random: sid,
            proxyKey: request.proxyKey,
            timestamp: request.timestamp
        }, privKey);
        console.debug(request);

        fetch("/login", {
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

function logout() {
    return new Promise((resolve, reject) => {
        fetch("/logout")
            .then(result => responseParse(result, false)
                .then(result => resolve(result))
                .catch(error => reject(error)))
            .catch(error => reject(error))
    })
}

function buy(quantity, max_price, proxySecret) {
    return new Promise((resolve, reject) => {
        if (typeof quantity !== "number" || quantity <= 0)
            return reject(`Invalid quantity (${quantity})`);
        else if (typeof max_price !== "number" || max_price <= 0)
            return reject(`Invalid max_price (${max_price})`);
        let request = {
            quantity: quantity,
            max_price: max_price,
            timestamp: Date.now()
        };
        request.sign = signRequest({
            type: "buy_order",
            quantity: quantity,
            max_price: max_price,
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        fetch('/buy', {
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

function sell(quantity, min_price, proxySecret) {
    return new Promise((resolve, reject) => {
        if (typeof quantity !== "number" || quantity <= 0)
            return reject(`Invalid quantity (${quantity})`);
        else if (typeof min_price !== "number" || min_price <= 0)
            return reject(`Invalid min_price (${min_price})`);
        let request = {
            quantity: quantity,
            min_price: min_price,
            timestamp: Date.now()
        };
        request.sign = signRequest({
            type: "sell_order",
            quantity: quantity,
            min_price: min_price,
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        fetch('/sell', {
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

function cancelOrder(type, id, proxySecret) {
    return new Promise((resolve, reject) => {
        if (type !== "buy" && type !== "sell")
            return reject(`Invalid type (${type}): type should be sell (or) buy`);
        let request = {
            orderType: type,
            orderID: id,
            timestamp: Date.now()
        };
        request.sign = signRequest({
            type: "cancel_order",
            order: type,
            id: id,
            timestamp: data.timestamp
        }, proxySecret);
        console.debug(request);

        fetch('/cancel', {
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

function depositFLO(quantity, userID, privKey, proxySecret) {
    return new Promise((resolve, reject) => {
        if (typeof quantity !== "number" || quantity <= floGlobals.fee)
            return reject(`Invalid quantity (${quantity})`);
        floBlockchainAPI.sendTx(userID, floGlobals.adminID, quantity, privKey, 'Deposit FLO in market').then(txid => {
            let request = {
                txid: txid,
                timestamp: Date.now()
            };
            request.sign = signRequest({
                type: "deposit_FLO",
                txid: request.txid,
                timestamp: request.timestamp
            }, proxySecret);
            console.debug(request);

            fetch('/deposit-flo', {
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

function withdrawFLO(quantity, proxySecret) {
    return new Promise((resolve, reject) => {
        let request = {
            amount: quantity,
            timestamp: Date.now()
        };
        request.sign = signRequest({
            type: "withdraw_FLO",
            amount: request.amount,
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        fetch('/withdraw-flo', {
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

function depositRupee(quantity, userID, privKey, proxySecret) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.verifyPrivKey(privKey, userID))
            return reject("Invalid Private Key");
        tokenAPI.sendToken(privKey, quantity, 'Deposit Rupee in market').then(txid => {
            let request = {
                txid: txid,
                timestamp: Date.now()
            };
            request.sign = signRequest({
                type: "deposit_Rupee",
                txid: request.txid,
                timestamp: request.timestamp
            }, proxySecret);
            console.debug(request);

            fetch('/deposit-rupee', {
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

function withdrawRupee(quantity, proxySecret) {
    return new Promise((resolve, reject) => {
        let request = {
            amount: quantity,
            timestamp: Date.now()
        };
        request.sign = signRequest({
            type: "withdraw_Rupee",
            amount: request.amount,
            timestamp: request.timestamp
        }, proxySecret);
        console.debug(request);

        fetch('/withdraw-rupee', {
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