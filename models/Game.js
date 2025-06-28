const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    game_code: String,
    player_body_images: [String],
    player_body_parts_with_player_names: [String],
    player_current_step: [Number],
    player_image: String,
    player_name: String,
    player_number: Number
});

const gameSchema = new mongoose.Schema({
    created_at: {
        type: Date,
        default: Date.now
    },
    drawing_time: Number,
    game_code: {
        type: String,
        required: true,
        unique: true
    },
    games_Parts: [String],
    join: Boolean,
    number_of_players: Number,
    start_game: Boolean,
    players: [playerSchema]
});

module.exports = mongoose.model('Game', gameSchema); 