var Game = function (firebase, url, gameId, size) {
    this.fb = firebase;
    this.url = url;
    this.size = size;
    this.gameId = gameId;
    this.playingState = Game.PlayingState.Watching;
    this.playerNum = null;
    this.board = null;
    this.init();
};

Game.PlayingState = {Watching: 0, Joining: 1, Playing: 2};
Game.color = {BLACK: "BLACK", WHITE: "WHITE"};

Game.prototype.init = function () {
    this.board = new Board(this.fb, this.size, this.gameId);
    this.addShareLink();
    this.waitToJoin();

    var $gameAlertToplay = $('#game-alert-toplay');
    var $welcomeLogin = $('#welcome-login');

    this.fb.ref().onAuth(function (authData) {
        if (authData) {
            $gameAlertToplay.addClass('is-hidden');
            $welcomeLogin.addClass('is-hidden');
        } else {
            $gameAlertToplay.removeClass('is-hidden');
            $welcomeLogin.removeClass('is-hidden');
        }
    });
};

Game.prototype.addShareLink = function () {
    var link = $("#share-link");
    if (link !== null) {
        link.text(window.location.href).attr('href', window.location.href);
    }
};

Game.prototype.getColor = function () {
    if (this.playerNum === null) {
        return null;
    }
    return (this.playerNum === 0) ? Game.color.BLACK : Game.color.WHITE;
};

Game.prototype.waitToJoin = function () {
    var self = this;

    // Listen on 'online' location for player0 and player1.
    function join(playerNum) {
        self.fb.on('games/' + self.gameId + '/players/' + playerNum + '/online', 'value').progress(function (snap) {
            if (_.isNull(snap.val()) && _.isEqual(self.playingState, Game.PlayingState.Watching)) {
                console.log("waitToJoin", playerNum);
                self.tryToJoin(playerNum);
            }
            self.presence(playerNum, snap.val());
        });
    }

    this.fb.ref().onAuth(function (authData) {
        if (authData) {
            join(0);
            join(1);
        }
    });

    this.watchForNewStones();
    this.watchForNewScore();
};

Game.prototype.tryToJoin = function (playerNum) {
    this.playerNum = playerNum;

    // Set ourselves as joining to make sure we don't try to join as both players. :-)
    this.playingState = Game.PlayingState.Joining;

    // Use a transaction to make sure we don't conflict with other people trying to join.
    var self = this;
    this.fb.ref().child('games/' + self.gameId + '/players/' + playerNum + '/online').transaction(function (snap) {
        console.log("player " + playerNum + " tryToJoin transaction ", snap);
        if (snap === null) {
            self.fb.initToken(playerNum);
            return true; // Try to set online to true
        } else {
            return; // Somebody must have beat us.  Abort the transaction.
        }
    }, function (error, committed) {
        console.log("tryToJoin error ", committed);
        if (committed) { // We got in!
            self.playingState = Game.PlayingState.Playing;
            self.startPlaying(playerNum);
        } else {
            self.playingState = Game.PlayingState.Watching;
        }
    });
};

/**
 * Once we've joined, enable controlling our player.
 */
Game.prototype.startPlaying = function (playerNum) {
    this.myPlayerRef = this.fb.ref().child('games/' + this.gameId + '/players/' + playerNum);

    // Clear our 'online' status when we disconnect so somebody else can join.
    this.myPlayerRef.child('online').onDisconnect().remove();

    $("#player-num").text('- player ' + playerNum);

    var self = this;
    $(".cell").on("click", function (event) {
        var ids = event.target.id.split("-"),
            x = ids[0],
            y = ids[1];

        var color = self.board.get(x, y);
        if (color !== undefined && !_.isEqual(color, self.getColor())) {
            self.board.removeStone(x, y, playerNum);
            return;
        }

        self.board.setStoneFirebase(x, y, self.getColor(), playerNum);
    });

    $("#skip").on("click", function (event) {
        self.board.skipTurnFirebase(playerNum);
    });
};

/**
 * Detect when our opponent pushes extra rows to us.
 */
Game.prototype.watchForNewStones = function () {
    var self = this;

    this.fb.once('games/' + this.gameId + '/goban', 'value').then(function (snaps) {
        snaps.forEach(function (snap) {
            var coord = snap.key().split("-");
            var stone = snap.val();
            self.board.setStone(parseInt(coord[0]), parseInt(coord[1]), stone);
        });
    });

    this.fb.on('games/' + this.gameId + '/goban', 'child_added').progress(function (snap) {
        var coord = snap.key().split("-");
        var stone = snap.val();
        self.board.setStone(parseInt(coord[0]), parseInt(coord[1]), stone);
    });

    this.fb.on('games/' + this.gameId + '/goban', 'child_removed').progress(function (snap) {
        var coord = snap.key().split("-");
        self.board.removeStone(parseInt(coord[0]), parseInt(coord[1]));
    });
};

Game.prototype.watchForNewScore = function () {
    this.fb.on('games/' + this.gameId + '/players/0/score', 'value').progress(function (snap) {
        var score = snap.val();
        if (!_.isNull(score)) {
            $('#scorePlayer0').text(snap.val());
        }
    });

    this.fb.on('games/' + this.gameId + '/players/1/score', 'value').progress(function (snap) {
        var score = snap.val();
        if (!_.isNull(score)) {
            $('#scorePlayer1').text(snap.val());
        }
    });
};

Game.prototype.presence = function (playerNum, user) {
    if (_.isEqual(playerNum, this.playerNum)) {
        return;
    }

    if (user) {
        $("#presence")
            .addClass('label-success')
            .removeClass('label-info')
            .text("★ partner online");
    } else {
        $("#presence")
            .addClass('label-info')
            .removeClass('label-success')
            .text("☆ partner idle");
    }
};
