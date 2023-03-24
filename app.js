"use strict";

/* this app is using the bolt js framework v3.12.2 */
/* written and operated by jordan sansing */

/*   npm list:                 */
/*      - @slack/bolt@3.12.2   */
/*      - axios@1.3.4          */
/*      - dotenv@16.0.3        */
/*      - mysql@1.0.2          */


import * as mysql from 'mysql';
import * as dotenv from 'dotenv';
import axios from 'axios';


/* ES6 module importing lol ""standardization"" */
import bolt_pkg from '@slack/bolt';
const { App } = bolt_pkg;
import slack_pkg from '@slack/web-api';
const { WebClient } = slack_pkg;


/* dot.env vars */
dotenv.config()
const yak_token = process.env.YAK_TOKEN; //xoxb
const yak_signing = process.env.YAK_SIGNING;
const app_token = process.env.APP_TOKEN; //xxap
const gpt_token = process.env.GPT_TOKEN;
const username = process.env.SQL_USERNAME;
const password = process.env.SQL_PASSWORD;


/* db host addres */
const host = '127.0.0.1';
const database = 'gpt';


/* construct database connection object */
const connPool = mysql.createPool({
    connectionLimit: 10,
    host: host,
    user: username,
    password: password,
    database: database
  });


/* global vars relevant to the app/ slack relationship */
/* focus channel aka the channel id, only listening in one channel */
const focus_channel = 'C0501V4HLH1'; 
const yak = 'B04UW0K02TE';


/* bolt.js app constructor */
const app = new App({
    token: yak_token,
    socketMode: true,
    signingSecret: yak_signing,
    appToken: app_token,
    ignoreSelf: false, // careful
});


/* bolt.js client constructor */
const client = new WebClient(yak_token);


/* openai gpt global vars */
const auth_header = `Bearer ${gpt_token}`;
const api = 'https://api.openai.com/v1/chat/completions';


/* function that takes in a message event and posts a message to a newly created thread */
async function startThread(e){
    client.chat.postMessage({
        channel: focus_channel,
        text: "what would you like to ask?",
        thread_ts: e.ts
    })
};


/* function that takes in a command event and sends a message to the channel. this in turn
   posts a message to the channel via the bot that the app.event('message') function catches. 
   please treat with care, as the app contructor has flagged the bot able to respond to itself. 
   this is needed because the bot otherwise doesn't trigger the message event when sending messages. 
   you must handle bot messages carefully by guard clausing message events so the bot doesnt go on
   a rampage, this is particularily bad when making api calls that are rate limited. */
async function postMessage(c){
    client.chat.postMessage({
        channel: focus_channel,
        text: `!session for { ${c.user_name} } ...`,
    })
};


/* function to add a user to the database. silently ignore the errors of data existing in the db */
function addUserToDb(c){

    const addUserQuery = 'INSERT IGNORE INTO users (userID, userName) VALUES(?,?);';
    const addUserQuerySani = [c.user_id, c.user_name];

    connPool.query(addUserQuery, addUserQuerySani, (err, res) => {
        if (err){
            console.error(`error adding user into database ... ${err}`)
        } else if (res){
            console.log(`user: ${c.user_name} is logged to the database ${database}`)

            /* if this was successful let's post a message to the channel to start the flow */
            postMessage(c);
        }

    })
};


/* the "main" function. this slash command is the entry point for the app and the gpt flow */
app.command('/gpt_start', async ({ command, ack }) => {


        /* after the slash command we want to try to add this user to the database */
        if (command.channel_id == focus_channel){
            addUserToDb(command);
            
        }


        /* send HTTP ack to the command*/
        await ack();

})


/* the primary function for this app, listens to all messages and interacts given some conditions */
app.event('message', async ({ event, client }) => {


    /* if the message is in the bots channel, and the message starts
        with the trigger word, call function to start a new thread. */
    if (event.channel == focus_channel){
        if(event.text.startsWith('!session') & event.bot_id == yak){

        /* doesnt do much for the workflow, the bot will respond to the thread */
        startThread(event)
        }
        
    }

    
    /* really hacky - if the event has a thread timestamp. */
    if (event.thread_ts){
        if (event.bot_id != yak){
            gpt(event.user, event.text, client, event.thread_ts)
        }
    }

    
    /* compute and return the num of tokens and estimate of the price. */
    if (event.text == '!cost'){
        let costQuery = 'SELECT * FROM tokens';
        connPool.query(costQuery, (err, res) => {
            if (err){
                console.error(`err running token select from db ... ${err}`)
            } else if (res){
                let cost = (res[0].tokenCount / 1000) * 0.002;
                client.chat.postMessage({
                    channel: focus_channel,
                    text: `${res[0].tokenCount} tokens have been stored in the database. \n
this roughy equates to a total price of $${cost}`,
                })
            }
        })
    }

});


/* function that selects content from the database to feed gpt as a convo history, unique per session */
function dbReadThenRequest(client, ts){
    /* convo history time using the database */
    const sessionHistoryQuery = 'SELECT role, content FROM session WHERE sessionID = ? ORDER BY RID DESC LIMIT 10;';
    const sessionHistoryQuerySani = [ts]
    connPool.query(sessionHistoryQuery, sessionHistoryQuerySani, (err, res) => {
        if (err) {
            console.error(`error when building the convo history ... ${err}`)
        } else if(res) {
            let tst = Object.values(JSON.parse(JSON.stringify(res)))
            console.log(tst)
            httpRequest(tst, client, ts)
        }
    })
}


/* funcion that accepts user input as a string, a client object, and the 
   timestamp of a thread to reply to. returns the gpt response as a message
   to that thread. */
function gpt(user, input, client, ts){


    /* okay so "thread_ts" is going to be the session key for conversations */
    const sessionInputQueryUser = 'INSERT INTO session (sessionID, userID, role, content) VALUES(?,?,?,?);';
    const sessionInputQueryUserSani = [ts, user, "user", input];
    connPool.query(sessionInputQueryUser, sessionInputQueryUserSani, (err, res) => {
        if (err) {
            console.error(`error adding session to the database ... ${err}`)
        } else if(res){
            dbReadThenRequest(client, ts)
            console.log(`successfully added session data (user): ${ts} to the database.`)
        }
    })
  
};


/* function that makes the axios http request to openai, returns a response and 
   fires off a function to reply in the originating thread */
function httpRequest(convo, client, ts){


    /* the http shit */
    axios.request({
        method: 'post',
        url: api,
        headers: {
                Authorization: auth_header,
        },
        data: {
                model: 'gpt-3.5-turbo',
                messages: convo, 
                max_tokens: 256,
                temperature: 1.0,
                top_p: 1.0,
                frequency_penalty: 1.0,
        }
    })
    .then((res) => { replyInThread(res, client, ts) })
    .catch((error) => console.log(error))
}


/* function that performs the focused thread reply of the gpt response */
function replyInThread(res, client, ts){


    /* var to store the gpt response for this message */
    let resp = res.data.choices[0].message.content;


    /* try to log the assistants messages to the database */
    const sessionInputQueryAssistant = 'INSERT INTO session (sessionID, userID, role, content) VALUES(?,?,?,?);';
    const sessionInputQueryyAssistantSani = [ts, yak, "assistant", resp];
    connPool.query(sessionInputQueryAssistant, sessionInputQueryyAssistantSani, (err, res) => {
        if (err) {
            console.error(`error adding session to the database ... ${err}`)
        } else if(res){
            console.log(`successfully added session data (assistant): ${ts} to the database.`)
        }
    })


    /* var to store the token count for this message */
    let tokens = res.data.usage.total_tokens;


    /* post gpt response to the focused thread 
       via the timestamp arg passed to this function. */
    client.chat.postMessage({
        channel: focus_channel,
        text: `${resp} \n
{tokens used for this message: ${tokens}}`,
        thread_ts: ts
        });


    /* update token count in database */
    let tokenQuery = `UPDATE tokens SET tokenCount = tokenCount + ?;`
    let tokenQuerySani = [tokens]
    connPool.query(tokenQuery, tokenQuerySani, (err, res) => {
        if (err) {
            console.error(`err inserting tokens into db... ${err}`)
        } else if (res) {
            console.log("successfully added token count to db")
        }
    })

      
}


/* starts program loop */
(async () => {
    await app.start();
    console.log('bot is live');
  })();
