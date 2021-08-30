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
    global.PUBLIC_DIR = public_dir;
    console.log(PUBLIC_DIR);
    Database(config["sql_user"], config["sql_pwd"], config["sql_db"], config["sql_host"]).then(DB => {
        const app = App(config['secret'], DB);
        app.listen(PORT, () => console.log(`Server Running at port ${PORT}`));
    });
};