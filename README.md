# exchange-market
 Exchange market for FLO to rupee# and vise-versa

## Run `commands`
---------------

```
npm install                     - Install the app and node modules.
npm run help                    - List all commands.
npm run setup                   - Finish the setup (configure and reset password).
npm run configure               - Configure the app.
npm run reset-password          - Reset the password (for private-key).
npm run create-schema           - Create schema in MySQL database.

npm start                       - Start the application (main).
```
**NOTE:**
env variable `PASSWORD` required for `npm start`.

Windows:
```
$env:PASSWORD="<password>"; npm start
```
Linux:
```
PASSWORD="<password"> npm start
```
*(Optional)*
Multiple instance can be run/setup on the same dir with different config files by using env variable 'I'.

Windows: 
```
$env:I="<instance_ID>"; <command>
```
Linux: 
```
I="<instance_ID>" <command>
```
