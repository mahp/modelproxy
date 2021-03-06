/** 
 * ProxyFactory, Proxy
 * This class is provided to create proxy objects following the configuration
 * @author ShanFan
 * @created 24-3-2014
 */

// Dependencies
var fs = require( 'fs' )
  , http = require( 'http' )
  , url = require( 'url' )
  , querystring = require( 'querystring' )
  , iconv = require( 'iconv-lite' )
  , BufferHelper = require( 'bufferhelper' );

var InterfacefManager = require( './interfacemanager' );

// Instance of InterfaceManager, will be intialized when the proxy.use() is called.
var interfaceManager;

var STATUS_MOCK = 'mock';
var STATUS_MOCK_ERR = 'mockerr';
var ENCODING_RAW = 'raw';

// Current Proxy Status
// var CurrentStatus;

// Proxy constructor
function Proxy( options ) {
    // console.log(30,options);
    this._opt = options || {};
    this._urls = this._opt.urls || {};
    if ( this._opt.status === STATUS_MOCK || this._opt.status === STATUS_MOCK_ERR ) {
        return;
    }
    var currUrl = this._urls[ this._opt.status ];

    if ( !currUrl ) {
        throw new Error( 'No url can be proxied!' );
    };

    var urlObj = url.parse( currUrl );
    this._opt.hostname = urlObj.hostname;
    this._opt.port = urlObj.port || 80;
    this._opt.path = urlObj.path;
    this._opt.method = (this._opt.method || 'GET').toUpperCase();
}

/**
 * use
 * @param {InterfaceManager} ifmgr
 * @throws errors
 */
Proxy.use = function( ifmgr ) {

    if ( ifmgr instanceof InterfacefManager ) {
        interfaceManager = ifmgr;
    } else {
        throw new Error( 'Proxy can only use instance of InterfacefManager!' );
    }

    this._engineName = interfaceManager.getEngine();

    return this;
};

Proxy.getMockEngine = function() {
    if ( this._mockEngine ) {
        return this._mockEngine;
    }
    return this._mockEngine = require( this._engineName );
};

Proxy.getInterfaceIdsByPrefix = function( pattern ) {
    return interfaceManager.getInterfaceIdsByPrefix( pattern );
};

// @throws errors
Proxy.getRule = function( interfaceId ) {
    return interfaceManager.getRule( interfaceId );
};

// {Object} An object map to store created proxies. The key is interface id
// and the value is the proxy instance. 
Proxy.objects = {};

// Proxy factory
// @throws errors
Proxy.create = function( interfaceId ) {
    if ( !!this.objects[ interfaceId ] ) {
        return this.objects[ interfaceId ];
    }
    var opt = interfaceManager.getProfile( interfaceId );
    if ( !opt ) {
        throw new Error( 'Invalid interface id: ' + interfaceId );
    }
    return this.objects[ interfaceId ] = new this( opt );
};

Proxy.prototype = {
    addRedisCache:function(reqObj,data){
        /* 讲数据添加到redis缓存 */
        var _key = reqObj.proxy._opt.id,
            _expire = reqObj.expire,
            _value = data;

        redisUtils.setRedis(_key,_value,_expire,function(err,respose){
            if(err){
                console.log("\033[31mcached["+_key+"] error:"+err+"\033[0m");
            }
            else{
                console.log("\033[32mcached successfully:"+_key+"\033[0m");
            }
        });
    },

    checkRedisCache:function(reqObj, requestCallback,successCallback,cookie){
        if(!!!reqObj.expire || reqObj.expire<=0){
            return requestCallback && requestCallback();
        }

        var _key = reqObj.proxy._opt.id;
        redisUtils.getRedis(_key,function(err,data){
            if(err){
                // fetch data by request
                requestCallback && requestCallback();
            }
            else{
                if(data === null){
                    return requestCallback && requestCallback();
                }
                console.log("\033[32mfrom cache:"+_key+"\033[0m");
                return successCallback(data);
            }
        })
    },

    request: function( reqObj, callback, errCallback, cookie ) {
        // if ( typeof callback !== 'function' ) {
        //     console.error( 'No callback function for request = ', this._opt );
        //     return;
        // }
        var params = reqObj.params;

        if ( this._opt.isCookieNeeded === true && cookie === undefined ) {
            throw new Error( 'This request is cookie needed, you must set a cookie for it before request. id = ' + this._opt.id );
        }

        errCallback = typeof errCallback !== 'function' 
                    ? function( e ) { console.error( e ); }
                    : errCallback;

        if ( this._opt.status === STATUS_MOCK 
                || this._opt.status === STATUS_MOCK_ERR ) {
            this._mockRequest( params, callback, errCallback );
            return;
        }
        var self = this;
        // self._opt.hostname="new.juxiangyou.cm";
        var options = {
            hostname: self._opt.hostname,
            port: self._opt.port,
            path: self._opt.path,
            method: self._opt.method,
            headers: { 'Cookie': cookie }
        };
        var querystring = self._queryStringify( params );
        console.log("querystring:"+JSON.stringify(querystring));

        // // Set cookie
        // options.headers = {
        //     'Cookie': cookie
        // }
        cookie = cookie || [];
        cookie.concat["name=wmmang"];
        if ( self._opt.method === 'POST' ) {
            options.headers[ 'Content-Type' ] = 'application/x-www-form-urlencoded';
            options.headers[ 'Content-Length' ] = querystring.length;
            options.headers[ 'Cookie' ] = cookie;

        } else if ( self._opt.method === 'GET' ) {
            options.path += '?' + querystring;
            options.headers[ 'Content-Type' ] = "application/json;charset=UTF-8";
            options.headers[ 'Cookie' ] = cookie;
        }
       

        for(var key in options.headers){
            console.log("key:"+key+",value:"+options.headers[key]);
        }

        //检测是否存在redis缓存
        self.checkRedisCache(reqObj,function(){
            var req = http.request( options, function( res ) {

                var timer = setTimeout( function() {
                    errCallback( new Error( 'timeout' ) );
                }, self._opt.timeout || 5000 );

                var bufferHelper = new BufferHelper();
                
                res.on( 'data', function( chunk ) {
                    bufferHelper.concat( chunk );
                } );
                res.on( 'end', function() {
                    var buffer = bufferHelper.toBuffer();
                    try {
                        var result = self._opt.encoding === ENCODING_RAW 
                            ? buffer
                            : ( self._opt.dataType !== 'json' 
                                ? iconv.fromEncoding( buffer, self._opt.encoding )
                                : JSON.parse( iconv.fromEncoding( buffer, self._opt.encoding ) ) );
                    } catch ( e ) {
                        clearTimeout( timer );
                        errCallback( new Error( "The result has syntax error. " + e ) );
                        return;
                    }
                    clearTimeout( timer );
                    //get data sucessfully
                    
                    //add redis cache
                    var _key = reqObj.proxy._opt.id || ""; 

                    console.log("\033[32mfrom request:"+_key+"\033[0m");

                    reqObj.expire && reqObj.expire>0 && self.addRedisCache(reqObj,result);

                    callback( result, res.headers['set-cookie'] );

                } );

            } );

            self._opt.method !== 'POST' || req.write( querystring );

            req.on( 'error', function( e ) {
                errCallback( e );
            } );

            req.end();

        },callback,cookie);

    },
    getOption: function( name ) {
        return this._opt[ name ];
    },
    _queryStringify: function( params ) {
        if ( !params || typeof params === 'string' ) {
            return params || '';
        } else if ( params instanceof Array ) {
            return params.join( '&' );
        }
        var qs = [], val;
        for ( var i in params ) {
            val = typeof params[i] === 'object' 
                ? JSON.stringify( params[ i ] )
                : params[ i ];
            qs.push( i + '=' + encodeURIComponent(val) );
        }
        return qs.join( '&' );
    },
    _mockRequest: function( params, callback, errCallback ) {
        try {
            var engine = Proxy.getMockEngine();
            if ( !this._rule ) {
                this._rule = Proxy.getRule( this._opt.id );
            }
            if ( this._opt.isRuleStatic ) {
                callback( this._opt.status === STATUS_MOCK
                    ? this._rule.response 
                    : this._rule.responseError );
                return;
            }

            // special code for river-mock
            if ( Proxy._engineName === 'river-mock' ) {
                callback( engine.spec2mock( this._rule ) );
                return;
            }
            // special code for mockjs
            callback( this._opt.status === STATUS_MOCK
                ? engine.mock( this._rule.response )
                : engine.mock( this._rule.responseError )
            );
        } catch ( e ) {
            errCallback( e );
        }
    },
    interceptRequest: function( req, res ) {
        if ( this._opt.status === STATUS_MOCK
                || this._opt.status === STATUS_MOCK_ERR ) {
            this._mockRequest( {}, function( data ) {
                res.end( typeof data  === 'string' ? data : JSON.stringify( data ) );
            }, function( e ) {
                // console.error( 'Error ocurred when mocking data', e );
                res.statusCode = 500;
                res.end( 'Error orccured when mocking data' );
            } );
            return;
        }
        var self = this;
        var options = {
            hostname: self._opt.hostname,
            port: self._opt.port,
            path: self._opt.path + '?' + req.url.replace( /^[^\?]*\?/, '' ),
            method: self._opt.method,
            headers: req.headers
        };

        options.headers.host = self._opt.hostname;
        // delete options.headers.referer;
        // delete options.headers['x-requested-with'];
        // delete options.headers['connection'];
        // delete options.headers['accept'];
        delete options.headers['accept-encoding'];
        
        var req2 = http.request( options, function( res2 ) {
            var bufferHelper = new BufferHelper();

            res2.on( 'data', function( chunk ) {
                bufferHelper.concat( chunk );
            } );
            res2.on( 'end', function() {
                var buffer = bufferHelper.toBuffer();
                var result;
                try {
                    result = self._opt.encoding === ENCODING_RAW 
                        ? buffer
                        : iconv.fromEncoding( buffer, self._opt.encoding );

                } catch ( e ) {
                    res.statusCode = 500;
                    res.end( e + '' );
                    return;
                }
                res.setHeader( 'Set-Cookie', res2.headers['set-cookie'] );
                res.setHeader( 'Content-Type'
                    , ( self._opt.dataType === 'json' ? 'application/json' : 'text/html' )
                        + ';charset=UTF-8' );
                res.end( result );
            } );
        } );

        req2.on( 'error', function( e ) {
            res.statusCode = 500;
            res.end( e + '' );
        } );
        req.on( 'data', function( chunck ) {
            req2.write( chunck );
        } );
        req.on( 'end', function() {
            req2.end();
        } );
        
    }
};

var ProxyFactory = Proxy;

ProxyFactory.Interceptor = function( req, res ) {
    var interfaceId = req.url.split( /\?|\// )[1];
    if ( interfaceId === '$interfaces' ) {
        var interfaces = interfaceManager.getClientInterfaces();
        res.end( JSON.stringify( interfaces ) );
        return;
    }

    try {
        proxy = this.create( interfaceId );
        if ( proxy.getOption( 'intercepted' ) === false ) {
            throw new Error( 'This url is not intercepted by proxy.' );
        }
    } catch ( e ) {
        res.statusCode = 404;
        res.end( 'Invalid url: ' + req.url + '\n' + e );
        return;
    }
    proxy.interceptRequest( req, res );
};

module.exports = ProxyFactory;

