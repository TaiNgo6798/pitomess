const axios = require('axios').default;


const config = {
  "appSecret": "690c409400dcb68f39cfaf21b22ba720",
  "pageAccessToken": "EABPXjDABNpMBAOrZC4xlTY1J6f8zNUb6GXFBM3BqZCIZATUq3eY17YpjkRv5cUXS3ablaFYlDxJfhRL2yduYmnqxxrytzznery8CRo6nxBiRsw3zcTLVcxdfTwTS4uTeQKr7ksyzu1Oti5uVa72u6PjAbcGqocUkBJqPW0qwAiuMuGgDYmQ",
  "validationToken": "pitotoken123$",
  "serverURL": "localhost",
  "pageId": "100088010493665"
}

export default function handler(req, res) {
  switch (req.method.toUpperCase()) {
    case "POST":
      POST_handler(req, res)
      break
    case "GET":
      GET_handler(req, res)
      break
  }
}

const GET_handler = (req, res) => {
  // Parse the query params
  let mode = req.query["hub.mode"];
  let token = req.query["hub.verify_token"];
  let challenge = req.query["hub.challenge"];

  // Check if a token and mode is in the query string of the request
  if (mode && token) {
    // Check the mode and token sent is correct
    if (mode === "subscribe" && token === config.validationToken) {
      // Respond with the challenge token from the request
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      // Respond with '403 Forbidden' if verify tokens do not match
      res.status(403).send("error");
    }
  }
}

const POST_handler = (req, res) => {
  console.log(":::::: Doing POST_handler ::::::")

  try {
    let data = req.body;
    //Make sure this is a page subscription
    if (data.object == 'page') {
      // Iterate over each entry
      // There may be multiple if batched
      data.entry.forEach(function (pageEntry) {
        let pageID = pageEntry.id;
        let timeOfEvent = pageEntry.time;

        // Iterate over each messaging event
        pageEntry.messaging.forEach(function (messagingEvent) {
          if (messagingEvent.message) {
            console.log(JSON.stringify(req))
            receivedMessage(messagingEvent);
          } else {
            console.log("Webhook received unknown messagingEvent: ", JSON.stringify(req));
          }
        });
      });

      // Assume all went well.
      //
      // You must send back a 200, within 20 seconds, to let us know you've 
      // successfully received the callback. Otherwise, the request will time out.
      res.status(200).send("ok");
    } else res.status(200).send("ok");
  } catch (err) {
    console.log(err)
    res.status(200).send("ok");
  }
}


/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message' 
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 * For this example, we're going to echo any text that we get. If we get some 
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've 
 * created. If we receive a message with an attachment (image, video, audio), 
 * then we'll simply confirm that we've received the attachment.
 * 
 */
function receivedMessage(event) {
  console.log(":::::: Running receivedMessage ::::::")
  let senderID = event.sender.id;
  let recipientID = event.recipient.id;
  let timeOfMessage = event.timestamp;
  let message = event.message;

  let isEcho = message.is_echo;
  let messageId = message.mid;
  let appId = message.app_id;
  let metadata = message.metadata;

  // You may get a text or attachment but not both
  let messageText = message.text;
  let quickReply = message.quick_reply;

  if (isEcho) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s",
      messageId, appId, metadata);
    return;
  } else if (quickReply) {
    let quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s",
      messageId, quickReplyPayload);

    sendTextMessage(senderID, "Quick reply tapped");
    return;
  }

  if (messageText) {
    // If we receive a text message, check to see if it matches any special
    // keywords and send back the corresponding example. Otherwise, just echo
    // the text we received.
    sendTextMessage(senderID, messageText);
    return
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
    },
    messaging_type: "RESPONSE"
  };

  callSendAPI(messageData);
}

function callSendAPI(messageData) {
  console.log(":::::: Doing callSendAPI with axios ::::::")
  console.log(messageData)
  axios({
    url: `https://graph.facebook.com/v2.6/me/messages?access_token=${config.pageAccessToken}`,
    method: 'post',
    data: messageData
  }).then(function (error, response, body) {
    console.log(":::::: Done ::::::")
    console.log({ error, response, body })

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
    }
  }).catch(() => {
    console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
  });
}