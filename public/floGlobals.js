const floGlobals = {

    //Required for all
    blockchain: "FLO",

    //Required for blockchain API operators
    apiURL: {
        FLO: ['https://livenet.flocha.in/', 'https://flosight.duckdns.org/'],
        FLO_TEST: ['https://testnet-flosight.duckdns.org', 'https://testnet.flocha.in/']
    },
    application: "exchange",
    adminID: "FKAEdnPfjXLHSYwrXQu377ugN4tXU7VGdf",
    sendAmt: 0.001,
    fee: 0.0005,
    tokenURL: "https://ranchimallflo.duckdns.org/",
    currency: "rupee"
};

(typeof global !== "undefined" ? global : window).cryptocoin = floGlobals.blockchain;
('object' === typeof module) ? module.exports = floGlobals: null;