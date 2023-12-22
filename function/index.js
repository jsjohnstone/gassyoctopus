const axios = require('axios')
const { Tado } = require('node-tado-client')
require('dotenv').config()

// Secret Manager
const AWS_SECRETS_EXTENTION_HTTP_PORT = 2773;
const AWS_SECRETS_EXTENTION_SERVER_ENDPOINT = `http://localhost:${AWS_SECRETS_EXTENTION_HTTP_PORT}/secretsmanager/get?secretId=`;

const getSecretValue = async (secretName) => {
    console.log("Retrieving secret from AWS Secrets Manager: " + secretName)
    const url = `${AWS_SECRETS_EXTENTION_SERVER_ENDPOINT}${secretName}`;
    let getSecretResponse = null;
    try {
        getSecretResponse = await axios.get(url, {
            headers: {
              "X-Aws-Parameters-Secrets-Token": process.env.AWS_SESSION_TOKEN,
            },
        });
        return JSON.parse(getSecretResponse.data.SecretString);
    } catch(e){
        console.log(`Error occured while requesting secret ${secretName}. Responses status was ${getSecretResponse.status}`)
        console.log(e)
}

  
};

// Handler
exports.handler = async function(event, context) {

    let geohomeUsername = null;
    let geohomePassword = null;
    let geohomeDeviceID = null;
    let tadoUsername = null;
    let tadoPassword = null;
    let tadoHomeID = null;
    let gassyOctopusSecrets = null;

    if(process.env.GASSYOCTOPUS_SECRET_NAME) {
        console.log("Getting secrets from AWS Secrets Manager")
        gassyOctopusSecrets = await getSecretValue(process.env.GASSYOCTOPUS_SECRET_NAME)
    }

    geohomeUsername = process.env.GEOHOME_USERNAME || gassyOctopusSecrets.geohomeUsername || null
    geohomePassword = process.env.GEOHOME_PASSWORD || gassyOctopusSecrets.geohomePassword || null
    geohomeDeviceID = process.env.GEOHOME_SYSTEMID || gassyOctopusSecrets.geohomeSystemId || null
    tadoUsername = process.env.TADO_USERNAME || gassyOctopusSecrets.tadoUsername || null
    tadoPassword = process.env.TADO_PASSWORD || gassyOctopusSecrets.tadoPassword || null
    tadoHomeID = process.env.TADO_HOMEID || gassyOctopusSecrets.tadoHomeId || null

    // Check if all required variables are set
    if(!geohomeUsername) {
        throw new Error('Missing GEOHOME_USERNAME variable')
    }
    if(!geohomePassword) {
        throw new Error('Missing GEOHOME_PASSWORD variable')
    }
    if(!tadoUsername) {
        throw new Error('Missing TADO_USERNAME variable')
    }
    if(!tadoPassword) {
        throw new Error('Missing TADO_PASSWORD variable')
    }
    if(!tadoHomeID) {
        throw new Error('Missing TADO_HOMEID variable')
    }

    // Set up constants
    const geohomeBase = "https://api.geotogether.com/"
    const geohomeLogin = "usersservice/v2/login"
    const geohomeDevices = "api/userapi/v2/user/detail-systems?systemDetails=true"
    const geohomePeriodic = "api/userapi/system/smets2-periodic-data/"
    const todayDate = new Date().toISOString().slice(0, 10);

    // Login to Geohome
    let geohomeLoginResponse = null;
    let geohomeAccessToken = null;
    try{
        geohomeLoginResponse = await axios.post(geohomeBase + geohomeLogin, {
            identity: geohomeUsername,
            password: geohomePassword
          })
        
          geohomeAccessToken = geohomeLoginResponse.data.accessToken
          console.log("Logged in as: " + geohomeUsername)
    } catch(e){
        console.log("Error logging in to geohome API")
    }

    // Build Geohome headers object
    const geohomeConfig = {
        headers: { Authorization: `Bearer ${geohomeAccessToken}` }
    };

    // Get Geohome devices
    if(!geohomeDeviceID) {
        console.log("No Geohome Device ID set, getting from API")
        let geohomeDeviceResponse = null;
        try{
            geohomeDeviceResponse = await axios.get(geohomeBase + geohomeDevices, geohomeConfig)
            geohomeDeviceID = geohomeDeviceResponse.data.systemDetails[0].systemId
            console.log("Geohome Device ID: " + geohomeDeviceID)
        } catch(e){
            console.log("Error getting geohome Device ID")
            console.log(e)
        }
    } else {
        console.log("Using Geohome Device ID: " + geohomeDeviceID)
    }

    // Get meter read from Geohome
    let geohomeMeterReadResponse = null;
    let geohomeGasTotalConsumption = null;
    try{
        geohomeMeterReadResponse = await axios.get(geohomeBase + geohomePeriodic + geohomeDeviceID, geohomeConfig)

        // Making an assumption there's only one gas meter, find it...
        let result = geohomeMeterReadResponse.data.totalConsumptionList.filter(obj => {
            return obj.commodityType === "GAS_ENERGY"
        })

        // Convert to m3
        geohomeGasTotalConsumption = Math.floor(result[0].totalConsumption / 1000)
        console.log("Gas total consumption: " + geohomeGasTotalConsumption);
    } catch(e){
        console.log("Error getting geohome Device ID")
        console.log(e)
    }

    // Create a tado client and login
    let tado = new Tado();
    try{
        await tado.login(tadoUsername, tadoPassword);
    } catch(e){
        console.log("Error logging in to Tado")
        console.log(e)
    }

    tado.getEnergyIQMeterReadings(tadoHomeID).then((readings) => {
    }).catch((e) => {
        console.log(e)
    })
    //Send meter read to Tado
    try {
        let tadoResult = await tado.addEnergyIQMeterReading(tadoHomeID, todayDate, geohomeGasTotalConsumption);
        console.log("✅ Successfully sent meter reading of " + geohomeGasTotalConsumption + "m3 for " + todayDate + "to Tado")
    } catch(e){
        console.log("Error submitting meter reading")
        console.log(e)
    }
}