const express = require("express");
const { showLogin } = require("../controllers/authController");

const router = express.Router();

router.get("/login", showLogin);

module.exports = router;