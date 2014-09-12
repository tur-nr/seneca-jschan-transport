const SPDY_PORT = 9323;
const WS_PORT = 3000;

var _ = require('underscore')
  , jschan = require('jschan')
  , plugin = 'jschan-transport';

module.exports = exports = function transport(config) {
  var seneca = this
    , util = seneca.util
    , log = seneca.log
    , options = seneca.options()
    , timeout;

  // transport timeout
  timeout = (options.timeout)
    ? options.timeout - 555
    : 22222;

  // configuration
  config = util.deepextend({
    jschan: {
      type: 'jschan',
      timeout: timeout
    }
  }, options.transport, config);

  // register plugins
  seneca.add('role:plugin,hook:listen,type:jschan', hookListen);
  seneca.add('role:plugin,hook:client,type:jschan', hookClient);

  // hook into transport listener
  function hookListen(args, done) {
    var opts = util.clean(_.extend({}, config[args.type], args))
      , server;

    // node or browser
    if (typeof window !== 'object') {
      server = jschan.spdyServer();
      server.listen(opts.port || SPDY_PORT);
    } else {
      server = jschan.websocketServer();
      server.listen(opts.port || WS_PORT);
    }

    // channel has data
    function onData(data) {
      // give to seneca

      // we cannot send through the default transport like redis, jschan
      // enables us to send streams through the channel

      // we also should handle a readable stream here to send back to the client
      // that we have received the channel and it should close it's session
    }

    // listen for session
    server.on('session', function onSession(session) {
      session.on('channel', function onChannel(channel) {
        channel.on('data', onData);
      })
    });

    // close the server when seneca closes
    seneca.add('role:seneca,cmd:close', function closeServer(args, done) {
      // server.end();
      this.prior(args, done);
    });


    log.info('listen', 'open', opts, seneca);
    done();
  }

  function hookClient(args, done) {
    var opts = util.clean(_.extend({}, config[args.type], args))
      , session
      , sender
      , receiver;

    // node or browser
    if (typeof window !== 'object') {
      session = jschan.spdyClientSession({ port: opts.port || SPDY_PORT });
    } else {
      session = jschan.websocketClientSession(/* todo: compose ws://host */);
    }

    // sender and receiver
    sender = session.WriteChannel();
    receiver = sender.ReadChannel();

    // close the session once we get a read from the server
    receiver.on('data', function onRead() {
      session.close();
    });

    sender.end(_.extend({ _receiver: receiver }, args));

    // don't think we need to close the session as it will handled by the 
    // receiver stream
  }

  return { name: plugin };
};