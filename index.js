var SPDY_PORT = 9323
  , WS_PORT = 3000
  , _ = require('underscore')
  , jschan = require('jschan')
  , clean = require('clean-obj')
  , plugin = 'jschan-transport'
  , isBrowser;

// are we in the browser
isBrowser  = (function() {
  return (typeof window !== 'undefined') && (this === window);
}());

// begin transport plugin
module.exports = exports = function transport(config) {
  var seneca = this
    , util = seneca.util
    , log = seneca.log
    , options = seneca.options()
    , timeout
    , trans
    , port;

  // transport timeout
  timeout = (options.timeout)
    ? options.timeout - 555
    : 22222;

  // given port
  if (config.port) {
    port = config.port;
  } else {
    port = (isBrowser)
      ? WS_PORT
      : SPDY_PORT;
  }

  trans = seneca.export('transport/utils');

  // configuration
  config = util.deepextend({
    jschan: {
      type: 'jschan',
      timeout: timeout,
      port: port
    }
  }, options.transport, config);

  // register plugins
  seneca.add('role:transport,hook:listen,type:jschan', hookListen);
  seneca.add('role:transport,hook:client,type:jschan', hookClient);

  // hook into transport listener
  function hookListen(args, done) {
    var opts = util.clean(_.extend({}, config[args.type], args))
      , server;

    // channel protocol
    // browser = socket, node = spdy
    server = (isBrowser)
      ? jschan.websocketServer()
      : jschan.spdyServer();

    // channel request
    function onData(data) {
      trans.handle_request(seneca, data, opts, function handleRequest(response) {
        if (response == null) return;
        // give response back to client

        // we need to clean the response result, jschan's underlying msgpack
        // can not encode undefined values. this will stop any values coming
        // through and causing an internal exception
        clean(response.res);

        data.response.end(response);
      });
    }

    // listen for session
    server.on('session', function onSession(session) {
      session.on('channel', function onChannel(channel) {
        channel.on('data', onData);
      });
    });

    // topics
    trans.listen_topics(seneca, args, opts, function listenTopics(topic) {
      log.debug('listen', 'session', topic + '_act', opts, seneca);

      // listen to topic
      server.listen(opts.port);
    });

    // close the server when seneca closes
    seneca.add('role:seneca,cmd:close', function closeServer(args, done) {
      server.close();
      this.prior(args, done);
    });

    log.info('listen', 'open', opts, seneca);
    done();
  }

  function hookClient(args, done) {
    var opts = util.clean(_.extend({}, config[args.type], args));

    trans.make_client(makeSend, opts, done);

    function makeSend(spec, topic, done) {
      var session
        , sender;

      // channel protocol
      // browser = websocket, node = spdy
      session = (isBrowser)
        ? jschan.websocketClientSession(/* todo: compose ws://host */)
        : jschan.spdyClientSession({ host: opts.host, port: opts.port });

      // sender channel
      sender = session.WriteChannel();

      log.debug('client', 'session', topic + '_res', opts, seneca);

      done(null, function send(args, done) {
        var response
          , data;

        // response channel
        response = sender.ReadChannel();

        // handle response channel
        response.on('data', function onResponse(response) {
          trans.handle_response(seneca, response, opts);
        });

        data = trans.prepare_request(this, clean(args), done);
        data.response = response; // gives the channel a writable response
        
        // transport ...woooosh!!
        sender.write(data);
      });

      // seneca cleanup
      seneca.add('role:seneca,cmd:close', function closeSession(args, done) {
        session.close();
        this.prior(args, done);
      });
    }
  }

  return { name: plugin };
};