'use strict';
/* FLO Blockchain Operator to send/receive data from blockchain using API calls*/
(function(GLOBAL){
    const floBlockchainAPI = GLOBAL.floBlockchainAPI =  {

        util: {
            serverList: floGlobals.apiURL[floGlobals.blockchain].slice(0),
            curPos: floCrypto.randInt(0, floGlobals.apiURL[floGlobals.blockchain].length - 1),
            fetch_retry: function(apicall) {
                return new Promise((resolve, reject) => {
                    this.serverList.splice(this.curPos, 1);
                    this.curPos = floCrypto.randInt(0, this.serverList.length - 1);
                    this.fetch_api(apicall)
                        .then(result => resolve(result))
                        .catch(error => reject(error));
                });
            },
            fetch_api: function(apicall) {
                return new Promise((resolve, reject) => {
                    if (this.serverList.length === 0)
                        reject("No floSight server working");
                    else {
                        fetch(this.serverList[this.curPos] + apicall).then(response => {
                            if (response.ok)
                                response.json().then(data => resolve(data));
                            else {
                                this.fetch_retry(apicall)
                                    .then(result => resolve(result))
                                    .catch(error => reject(error));
                            };
                        }).catch(error => {
                            this.fetch_retry(apicall)
                                .then(result => resolve(result))
                                .catch(error => reject(error));
                        });
                    };
                });
            }
        },
    
        //Promised function to get data from API
        promisedAPI: function(apicall) {
            return new Promise((resolve, reject) => {
                //console.log(apicall);
                this.util.fetch_api(apicall)
                    .then(result => resolve(result))
                    .catch(error => reject(error));
            });
        },
    
        //Get balance for the given Address
        getBalance: function(addr) {
            return new Promise((resolve, reject) => {
                this.promisedAPI(`api/addr/${addr}/balance`)
                    .then(balance => resolve(parseFloat(balance)))
                    .catch(error => reject(error));
            });
        },
    
        //Write Data into blockchain
        writeData: function(senderAddr, data, privKey, receiverAddr = floGlobals.adminID) {
            return new Promise((resolve, reject) => {
                if (typeof data != "string")
                    data = JSON.stringify(data);
                this.sendTx(senderAddr, receiverAddr, floGlobals.sendAmt, privKey, data)
                    .then(txid => resolve(txid))
                    .catch(error => reject(error));
            });
        },
    
        //Send Tx to blockchain 
        sendTx: function(senderAddr, receiverAddr, sendAmt, privKey, floData = '') {
            return new Promise((resolve, reject) => {
                if (!floCrypto.validateAddr(senderAddr))
                    reject(`Invalid address : ${senderAddr}`);
                else if (!floCrypto.validateAddr(receiverAddr))
                    reject(`Invalid address : ${receiverAddr}`);
                else if (privKey.length < 1 || !floCrypto.verifyPrivKey(privKey, senderAddr))
                    reject("Invalid Private key!");
                else if (typeof sendAmt !== 'number' || sendAmt <= 0)
                    reject(`Invalid sendAmt : ${sendAmt}`);
                else {
                    var trx = bitjs.transaction();
                    var utxoAmt = 0.0;
                    var fee = floGlobals.fee;
                    this.promisedAPI(`api/addr/${senderAddr}/utxo`).then(utxos => {
                        for (var i = utxos.length - 1; (i >= 0) && (utxoAmt < sendAmt + fee); i--) {
                            if (utxos[i].confirmations) {
                                trx.addinput(utxos[i].txid, utxos[i].vout, utxos[i].scriptPubKey);
                                utxoAmt += utxos[i].amount;
                            } else break;
                        };
                        if (utxoAmt < sendAmt + fee)
                            reject("Insufficient balance!");
                        else {
                            trx.addoutput(receiverAddr, sendAmt);
                            var change = utxoAmt - sendAmt - fee;
                            if (change > 0)
                                trx.addoutput(senderAddr, change);
                            trx.addflodata(floData.replace(/\n/g, ' '));
                            var signedTxHash = trx.sign(privKey, 1);
                            this.broadcastTx(signedTxHash)
                                .then(txid => resolve(txid))
                                .catch(error => reject(error));
                        };
                    }).catch(error => reject(error));
                };
            });
        },
    
        //merge all UTXOs of a given floID into a single UTXO
        mergeUTXOs: function(floID, privKey, floData = '') {
            return new Promise((resolve, reject) => {
                if (!floCrypto.validateAddr(floID))
                    return reject(`Invalid floID`);
                if (!floCrypto.verifyPrivKey(privKey, floID))
                    return reject("Invalid Private Key");
    
                var trx = bitjs.transaction();
                var utxoAmt = 0.0;
                var fee = floGlobals.fee;
                this.promisedAPI(`api/addr/${floID}/utxo`).then(utxos => {
                    for (var i = utxos.length - 1; i >= 0; i--)
                        if (utxos[i].confirmations) {
                            trx.addinput(utxos[i].txid, utxos[i].vout, utxos[i].scriptPubKey);
                            utxoAmt += utxos[i].amount;
                        };
                    trx.addoutput(floID, utxoAmt - fee);
                    trx.addflodata(floData.replace(/\n/g, ' '));
                    var signedTxHash = trx.sign(privKey, 1);
                    this.broadcastTx(signedTxHash)
                        .then(txid => resolve(txid))
                        .catch(error => reject(error));
                }).catch(error => reject(error));
            });
        },
    
        /**Write data into blockchain from (and/or) to multiple floID
         * @param  {Array} senderPrivKeys List of sender private-keys
         * @param  {string} data FLO data of the txn
         * @param  {Array} receivers List of receivers
         * @param  {boolean} preserveRatio (optional) preserve ratio or equal contribution
         * @return {Promise}
         */
        writeDataMultiple: function(senderPrivKeys, data, receivers = [floGlobals.adminID], preserveRatio = true) {
            return new Promise((resolve, reject) => {
                if (!Array.isArray(senderPrivKeys))
                    return reject("Invalid senderPrivKeys: SenderPrivKeys must be Array");
                if (!preserveRatio) {
                    let tmp = {};
                    let amount = (floGlobals.sendAmt * receivers.length) / senderPrivKeys.length;
                    senderPrivKeys.forEach(key => tmp[key] = amount);
                    senderPrivKeys = tmp;
                };
                if (!Array.isArray(receivers))
                    return reject("Invalid receivers: Receivers must be Array");
                else {
                    let tmp = {};
                    let amount = floGlobals.sendAmt;
                    receivers.forEach(floID => tmp[floID] = amount);
                    receivers = tmp;
                };
                if (typeof data != "string")
                    data = JSON.stringify(data);
                this.sendTxMultiple(senderPrivKeys, receivers, data)
                    .then(txid => resolve(txid))
                    .catch(error => reject(error));
            });
        },
    
        /**Send Tx from (and/or) to multiple floID
         * @param  {Array or Object} senderPrivKeys List of sender private-key (optional: with coins to be sent)
         * @param  {Object} receivers List of receivers with respective amount to be sent
         * @param  {string} floData FLO data of the txn
         * @return {Promise}
         */
        sendTxMultiple: function(senderPrivKeys, receivers, floData = '') {
            return new Promise((resolve, reject) => {
    
                let senders = {},
                    preserveRatio;
                //check for argument validations
                try {
                    let invalids = {
                        InvalidSenderPrivKeys: [],
                        InvalidSenderAmountFor: [],
                        InvalidReceiverIDs: [],
                        InvalidReceiveAmountFor: []
                    };
                    let inputVal = 0,
                        outputVal = 0;
                    //Validate sender privatekeys (and send amount if passed)
                    //conversion when only privateKeys are passed (preserveRatio mode)
                    if (Array.isArray(senderPrivKeys)) {
                        senderPrivKeys.forEach(key => {
                            try {
                                if (!key)
                                    invalids.InvalidSenderPrivKeys.push(key);
                                else {
                                    let floID = floCrypto.getFloID(key);
                                    senders[floID] = {
                                        wif: key
                                    };
                                };
                            } catch (error) {
                                invalids.InvalidSenderPrivKeys.push(key);
                            };
                        });
                        preserveRatio = true;
                    }
                    //conversion when privatekeys are passed with send amount
                    else {
                        for (let key in senderPrivKeys) {
                            try {
                                if (!key)
                                    invalids.InvalidSenderPrivKeys.push(key);
                                else {
                                    if (typeof senderPrivKeys[key] !== 'number' || senderPrivKeys[key] <= 0)
                                        invalids.InvalidSenderAmountFor.push(key);
                                    else
                                        inputVal += senderPrivKeys[key];
                                    let floID = floCrypto.getFloID(key);
                                    senders[floID] = {
                                        wif: key,
                                        coins: senderPrivKeys[key]
                                    };
                                };
                            } catch (error) {
                                invalids.InvalidSenderPrivKeys.push(key);
                            };
                        };
                        preserveRatio = false;
                    };
                    //Validate the receiver IDs and receive amount
                    for (let floID in receivers) {
                        if (!floCrypto.validateAddr(floID))
                            invalids.InvalidReceiverIDs.push(floID);
                        if (typeof receivers[floID] !== 'number' || receivers[floID] <= 0)
                            invalids.InvalidReceiveAmountFor.push(floID);
                        else
                            outputVal += receivers[floID];
                    };
                    //Reject if any invalids are found
                    for (let i in invalids)
                        if (!invalids[i].length)
                            delete invalids[i];
                    if (Object.keys(invalids).length)
                        return reject(invalids);
                    //Reject if given inputVal and outputVal are not equal
                    if (!preserveRatio && inputVal != outputVal)
                        return reject(`Input Amount (${inputVal}) not equal to Output Amount (${outputVal})`);
                } catch (error) {
                    return reject(error);
                }
                //Get balance of senders
                let promises = [];
                for (let floID in senders)
                    promises.push(this.getBalance(floID));
                Promise.all(promises).then(results => {
                    let totalBalance = 0,
                        totalFee = floGlobals.fee,
                        balance = {};
                    //Divide fee among sender if not for preserveRatio
                    if (!preserveRatio)
                        var dividedFee = totalFee / Object.keys(senders).length;
                    //Check if balance of each sender is sufficient enough
                    let insufficient = [];
                    for (let floID in senders) {
                        balance[floID] = parseFloat(results.shift());
                        if (isNaN(balance[floID]) || (preserveRatio && balance[floID] <= totalFee) 
                            || (!preserveRatio && balance[floID] < senders[floID].coins + dividedFee))
                            insufficient.push(floID);
                        totalBalance += balance[floID];
                    };
                    if (insufficient.length)
                        return reject({
                            InsufficientBalance: insufficient
                        });
                    //Calculate totalSentAmount and check if totalBalance is sufficient
                    let totalSendAmt = totalFee;
                    for (floID in receivers)
                        totalSendAmt += receivers[floID];
                    if (totalBalance < totalSendAmt)
                        return reject("Insufficient total Balance");
                    //Get the UTXOs of the senders
                    let promises = [];
                    for (floID in senders)
                        promises.push(this.promisedAPI(`api/addr/${floID}/utxo`));
                    Promise.all(promises).then(results => {
                        let wifSeq = [];
                        var trx = bitjs.transaction();
                        for (floID in senders) {
                            let utxos = results.shift();
                            let sendAmt;
                            if (preserveRatio) {
                                let ratio = (balance[floID] / totalBalance);
                                sendAmt = totalSendAmt * ratio;
                            } else
                                sendAmt = senders[floID].coins + dividedFee;
                            let wif = senders[floID].wif;
                            let utxoAmt = 0.0;
                            for (let i = utxos.length - 1; (i >= 0) && (utxoAmt < sendAmt); i--)
                                if (utxos[i].confirmations) {
                                    trx.addinput(utxos[i].txid, utxos[i].vout, utxos[i].scriptPubKey);
                                    wifSeq.push(wif);
                                    utxoAmt += utxos[i].amount;
                                };
                            if (utxoAmt < sendAmt)
                                return reject("Insufficient balance:" + floID);
                            let change = (utxoAmt - sendAmt);
                            if (change > 0)
                                trx.addoutput(floID, change);
                        };
                        for (floID in receivers)
                            trx.addoutput(floID, receivers[floID]);
                        trx.addflodata(floData.replace(/\n/g, ' '));
                        for (let i = 0; i < wifSeq.length; i++)
                            trx.signinput(i, wifSeq[i], 1);
                        var signedTxHash = trx.serialize();
                        this.broadcastTx(signedTxHash)
                            .then(txid => resolve(txid))
                            .catch(error => reject(error));
                    }).catch(error => reject(error));
                }).catch(error => reject(error));
            });
        },
    
        //Broadcast signed Tx in blockchain using API
        broadcastTx: function(signedTxHash) {
            return new Promise((resolve, reject) => {
                var request = new XMLHttpRequest();
                var url = this.util.serverList[this.util.curPos] + 'api/tx/send';
                console.log(url);
                if (signedTxHash.length < 1)
                    reject("Empty Signature");
                else {
                    var params = `{"rawtx":"${signedTxHash}"}`;
                    request.open('POST', url, true);
                    //Send the proper header information along with the request
                    request.setRequestHeader('Content-type', 'application/json');
                    request.onload = function() {
                        if (request.readyState == 4 && request.status == 200) {
                            console.log(request.response);
                            resolve(JSON.parse(request.response).txid.result);
                        } else
                            reject(request.responseText);
                    }
                    request.send(params);
                };
            });
        },
    
        //Read Txs of Address between from and to
        readTxs: function(addr, from, to) {
            return new Promise((resolve, reject) => {
                this.promisedAPI(`api/addrs/${addr}/txs?from=${from}&to=${to}`)
                    .then(response => resolve(response))
                    .catch(error => reject(error));
            });
        },
    
        //Read All Txs of Address (newest first)
        readAllTxs: function(addr) {
            return new Promise((resolve, reject) => {
                this.promisedAPI(`api/addrs/${addr}/txs?from=0&to=1`).then(response => {
                    this.promisedAPI(`api/addrs/${addr}/txs?from=0&to=${response.totalItems}0`)
                        .then(response => resolve(response.items))
                        .catch(error => reject(error));
                }).catch(error => reject(error));
            });
        },
    
        /*Read flo Data from txs of given Address
        options can be used to filter data
        limit       : maximum number of filtered data (default = 1000, negative  = no limit)
        ignoreOld   : ignore old txs (default = 0)
        sentOnly    : filters only sent data
        pattern     : filters data that starts with a pattern
        contains    : filters data that contains a string
        filter      : custom filter funtion for floData (eg . filter: d => {return d[0] == '$'})
        */
        readData: function(addr, options = {}) {
            options.limit = options.limit || 0;
            options.ignoreOld = options.ignoreOld || 0;
            return new Promise((resolve, reject) => {
                this.promisedAPI(`api/addrs/${addr}/txs?from=0&to=1`).then(response => {
                    var newItems = response.totalItems - options.ignoreOld;
                    this.promisedAPI(`api/addrs/${addr}/txs?from=0&to=${newItems*2}`).then(response => {
                            if (options.limit <= 0)
                                options.limit = response.items.length;
                            var filteredData = [];
                            for (let i = 0; i < (response.totalItems - options.ignoreOld) &&
                                filteredData.length < options.limit; i++) {
                                if (options.sentOnly && response.items[i].vin[0].addr !== addr)
                                    continue;
                                if (options.pattern) {
                                    try {
                                        let jsonContent = JSON.parse(response.items[i].floData)
                                        if (!Object.keys(jsonContent).includes(options.pattern))
                                            continue;
                                    } catch (error) {
                                        continue;
                                    }
                                }
                                if (options.filter && !options.filter(response.items[i].floData))
                                    continue;
                                filteredData.push(response.items[i].floData);
                            };
                            resolve({
                                totalTxs: response.totalItems,
                                data: filteredData
                            });
                        }).catch(error => {
                        reject(error);
                    });
                }).catch(error => {
                    reject(error);
                });
            });
        }
    }
})(typeof global !== "undefined" ? global : window);
