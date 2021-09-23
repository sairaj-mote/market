const config = require('../args/config.json');
global.floGlobals = require("./floGlobals");
require('./set_globals');
require('./lib');
require('./floCrypto');
require('./floBlockchainAPI');

const Database = require("./database");
const App = require('./app');
const PORT = config['port'];

module.exports = function startServer(public_dir) {

    global.myPrivKey = config["blockchain_private"];
    global.myPubKey = floCrypto.getPubKeyHex(global.myPrivKey);
    global.myFloID = floCrypto.getFloID(global.myPubKey);
    
    if (global.myFloID !== config["blockchain_id"] || !floCrypto.verifyPrivKey(global.myPrivKey, global.myFloID)) {
        console.error("Invalid Private Key for adminID");
        return;
    }
    floGlobals.adminID = config["blockchain_id"];
    global.PUBLIC_DIR = public_dir;
    console.log(PUBLIC_DIR, global.myFloID);
    
    Database(config["sql_user"], config["sql_pwd"], config["sql_db"], config["sql_host"]).then(DB => {
        const app = App(config['secret'], DB);
        app.listen(PORT, () => console.log(`Server Running at port ${PORT}`));
    });
};