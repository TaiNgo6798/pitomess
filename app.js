/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';
const
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  request = require('request'),
  parser = require('cron-parser'),
  dayjs = require('dayjs'),
  CronJob = require('cron').CronJob;

const DEFAULT_TIMEZONE = "Asia/Saigon"
const NO_TIMEZONE = false
const { v4: uuidv4 } = require('uuid');
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone') // dependent on utc plugin
const isToday = require('dayjs/plugin/isToday')
require("dayjs/locale/en");
dayjs.locale("en");
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isToday)

let runningCrons = {}
let app = express();
app.set('port', process.env.PORT || 6798);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

setInterval(() => {
  console.log(`:::Ping server:::`)
}, 2000);

/*
 * Be sure to setup your config values before running this code. You can 
 * set them using environment variables or modifying the config file in /config.
 *
 */

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ?
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and 
// assets located at this address. 
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

app.get('/', (req, res) => {
  res.status(200).send("Api is working :)");
})

/*
 * Use your own validation token. Check that the token used in the Webhook 
 * setup is the same token used here.
 *
 */
app.get('/webhook', function (req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
});

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook', function (req, res) {
  let data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function (pageEntry) {
      let pageID = pageEntry.id;
      let timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function (messagingEvent) {
        if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        }
        else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've 
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});


/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  let signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an 
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    let elements = signature.split('=');
    let signatureHash = elements[1];

    let expectedHash = crypto.createHmac('sha1', APP_SECRET)
      .update(buf)
      .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

function receivedMessage(event) {
  let senderID = event.sender.id;
  let recipientID = event.recipient.id;
  let timeOfMessage = event.timestamp;
  let message = event.message;

  console.log("Received message for user %d and page %d at %d with message:",
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  // You may get a text or attachment but not both
  let messageText = message.text;
  messageHandler(senderID, messageText)
}

const parseTime = (time, useTimeZone = true) => {
  if (!time) return "u never know :)"
  const date = useTimeZone ? dayjs(time).tz(DEFAULT_TIMEZONE) : dayjs(time)
  return date.isToday() ? date.format("HH:mm [hôm nay]") : date.format("HH:mm [ngày] DD/MM/YYYY");
}

const startCron = ({ callback, at, receiverId, cronText, oneTime }) => {
  const id = uuidv4()
  let job = new CronJob(
    at,
    () => {
      callback(receiverId, cronText)
      if (oneTime) {
        runningCrons[id].stop()
        delete runningCrons[id]
      }
    },
    null,
    true,
    DEFAULT_TIMEZONE
  );

  runningCrons[id] = job

  try {
    const interval = parser.parseExpression(at, { tz: DEFAULT_TIMEZONE });
    sendTextMessage(receiverId, `Oke toi sẽ nhắc bạn lúc ${interval.next().toDate()}`)
  } catch (err) {
    sendTextMessage(receiverId, `Parse error!`)
  }
}

const automationMessage = {
  "noti": ({ at, receiverId, message, oneTime = true }) => startCron({
    callback: sendTextMessage,
    at,
    receiverId,
    cronText: message,
    oneTime
  }),
  "crons": ({ receiverId }) => sendTextMessage(receiverId, `Có ${Object.keys(runningCrons).length} crons đang chạy`),
  "clear": ({ receiverId }) => {
    Object.entries(runningCrons).map(([id, job]) => {
      job.stop()
      delete runningCrons[id]
    })
    sendTextMessage(receiverId, `Có ${Object.keys(runningCrons).length} crons đang chạy`)
  }
}
//start=*/5 * * * * *
const messageHandler = (senderID, text = '') => {
  try {
    const [action, at, message, interval = ""] = text.split("\n")
    const executer = automationMessage[action]
    if (executer) {
      executer({ at, receiverId: senderID, message, oneTime: interval !== "repeat" })
    } else {
      sendTextMessage(senderID, "Khum hỉu hehe");
    }
  } catch (err) {
    sendTextMessage(senderID, err.message)
  }
}


/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  let messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText
    }
  };

  callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      let recipientId = body.recipient_id;
      let messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s",
          messageId, recipientId);
      } else {
        console.log("Successfully called Send API for recipient %s",
          recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.
app.listen(app.get('port'), function () {
  console.log('Node app is running on port', app.get('port'));
  sendTextMessage(config.get('myInboxId'), `Deployed: ${parseTime(Date.now())}`)
});

module.exports = app;