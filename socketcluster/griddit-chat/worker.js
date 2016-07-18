var fs = require('fs');
var express = require('express');
var serveStatic = require('serve-static');
var path = require('path');
var pg = require('pg');
var crypto = require('crypto')

var connectMsg = "Info: %s has joined the chatroom.";
var disconnectMsg = "Info: %s has left the chatroom.";
var welcomeMsg = "You are %s!";
var registerMsg = "Register <a href='http://griddit.io/users/new'>here</a> for your own unique username!";
var motd = "";
var userListMsg = "Users online: %s";
var startMsgHistory = "Showing message history.";
var endMsgHistory = "End of message history.";
var commandsMsg = "The following commands are available: %s";

var guestUsername = "Guest_%s";
var colors = ["d-re","l-bl","mage","red","pink","blue","teal","oran","d-pu"];

var commands = { 
  "/who":printChannelUserList,
  "/help":printAvailableCommands,
  "/me":selfActionCommand
};
var usersList = {};
var history = {};
var historyLength = 100;
var historyExpiry = 12*60*60*1000; // 12 hours

function selfActionCommand(scServer,socket,data) {
  var dataParts = data.msg.split(" ");
  var authToken = socket.getAuthToken();
  if (dataParts.length > 1 && authToken) {
    var action = dataParts.slice(1).join(" "); 
    scServer.global.publish(data.channel, {type: "info", msg: "%first %second".replace('%first',authToken.username).replace('%second', action)});
  }
}

function printMessageOfTheDay(scServer,socket,data) {
  if (motd) {
    socket.emit('info', {msg : motd});
  }
}

function printAvailableCommands(scServer,socket,data) {
  var commandsAvailable = Object.keys(commands).join(', ');
  socket.emit('info', {msg : commandsMsg.replace("%s",commandsAvailable)});
}

function printChannelHistory(scServer,socket,data) {
  if (data.channel in history && history[data.channel].length > 0 && historyLength > 0) {
    socket.emit('info', {msg: startMsgHistory});
    var time = new Date();
    var currTime = time.getTime()
    for (var i = 0; i < history[data.channel].length; ++i) {
      if (currTime - history[data.channel][i].time <= historyExpiry) {
        socket.emit('info', history[data.channel][i]);
      }
    }
    socket.emit('info', {msg: endMsgHistory});
  }
}

function printChannelUserList(scServer,socket,data) {
  socket.emit('info', {msg: userListMsg.replace("%s",Array.from(new Set(usersList[data.channel])).join(", "))});
}

function htmlEscape(str) {
  return String(str)
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\//g, '&#x2F;');
}

function generateRandomColor() {
  var color = colors[Math.floor(Math.random() * colors.length)];
  return color;
}

Date.prototype.timeNow = function () {
  return ((this.getHours() < 10)?"0":"") + this.getHours() +":"+ ((this.getMinutes() < 10)?"0":"") + this.getMinutes() +":"+ ((this.getSeconds() < 10)?"0":"") + this.getSeconds();
};

function generateGuestId() {
  var randomInt = Math.floor((Math.random() * 10000) + 1000);
  return guestUsername.replace("%s",randomInt);
}

function getSalt(username,done) {
  var client = new pg.Client(process.env.PUBNUB_DB_URL);
  client.connect();
  var query = client.query("SELECT salt from users where username = $1", [username]);
  var salt = ""
  query.on('row', function(row) {
    salt = row.salt;
    done(salt);
  });
  query.on('end', function() { 
    client.end();
  });
}

module.exports.run = function (worker) {
  console.log('   >> Worker PID:', process.pid);
  var app = require('express')();
  var httpServer = worker.httpServer;
  var scServer = worker.scServer;
  app.use(serveStatic(path.resolve(__dirname, 'public')));
  httpServer.on('request', app);

  scServer.on('connection', function (socket) {  
    var authToken = undefined;
    //Blocks publish except for server.
    scServer.addMiddleware(scServer.MIDDLEWARE_PUBLISH_IN, function (req, next) {
      next(true);
    });

    socket.on('disconnect', function() {
      //deauth everytime user disconnects.
      socket.deauthenticate();
    })

    socket.on('auth', function(data,res) {
      //Validate user
      if (data.username.substr(0,3) == "reg") {
        usernameParts = data.username.split("_");
        var assumedUsername = usernameParts.slice(1,usernameParts.length-1).join("_");
        getSalt(assumedUsername,function(salt) {

          var hash = crypto.createHmac('sha1', 'chat').update(salt+assumedUsername).digest('hex')
          if (hash == usernameParts[usernameParts.length-1]) {
            username = assumedUsername;
          } else {
            var username = generateGuestId();
          }
          socket.setAuthToken({username: htmlEscape(username), color: generateRandomColor(), isRegistered: true});
          socket.emit('info', {msg: welcomeMsg.replace("%s",username)});
        });
      } else {
        var username = generateGuestId();
        socket.setAuthToken({username: username, color: generateRandomColor(), isRegistered: false});
        socket.emit('info', {msg: welcomeMsg.replace("%s",username)});
        socket.emit('info', {msg: registerMsg});
      }
    });

    socket.on('chat', function (data) {
      if (!authToken) {
        authToken = socket.getAuthToken();
      }
      if (authToken) {
        var msg = data.msg;
        var cmd = msg.split(" ")[0].toLowerCase();
        if (cmd in commands) {
          commands[cmd](scServer,socket,data);
        } else {
          var time = new Date();
          data.username = authToken.username;
          data.color = authToken.color;
          data.time = time.getTime();
          data.type = "message";
          data.isRegistered = authToken.isRegistered;
          //fs.appendFile('/root/log.txt', time.timeNow() + "#" + data.username + "@" + data.channel + ": " + data.msg + "\r\n", function (err) {});
          if (historyLength > 0) {
            if (data.channel in history) {
              history[data.channel].push(data);
              history[data.channel] = history[data.channel].slice(-historyLength);
            } else {
              history[data.channel] = [data];
            }
          }
          scServer.global.publish(data.channel, data);
        }
      }
    });

    socket.on('subscribe', function (data) {
      if (!authToken) {
        authToken = socket.getAuthToken();
      }
      if (authToken){
        if (data in usersList) {
          usersList[data].push(authToken.username);
        } else {
          usersList[data] = [authToken.username];
        }
        printChannelHistory(scServer,socket,{channel:data});
        scServer.global.publish(data, {type: "info", msg: connectMsg.replace('%s',authToken.username)});
        printChannelUserList(scServer,socket,{channel:data});
        printAvailableCommands(scServer,socket,{channel:data});
        printMessageOfTheDay(scServer,socket,{channel:data});
      }
    });

    socket.on('unsubscribe', function (data) {
      if (!authToken) {
        authToken = socket.getAuthToken();
      }
      if (authToken){
        if (data in usersList) {
          var index = usersList[data].indexOf(authToken.username);
          usersList[data].splice(index,1);
        }
        scServer.global.publish(data, {type: "info", msg: disconnectMsg.replace('%s',authToken.username)});
      }
    });
  });
};
