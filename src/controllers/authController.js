import AdminModel from '../models/adminModel.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import { REMEMBER_ME_EXPIRY, SESSION_EXPIRY } from '../utils/constants.js';

export const login = async (req, res) => {
    try {
        const { username, password, rememberMe } = req.body;
        if(!username || !password) return res.status(400).json({error: 'All fields required'});

        const admin = await AdminModel.findAdminByUsername(username);
        if(!admin) return res.status(401).json({error: 'Invalid Credentials'});

        const isPasswordMatched = await bcrypt.compare(password, admin.PasswordHash);
        if(!isPasswordMatched) return res.status(401).json({error: 'Invalid Credentials'});

        const token = jwt.sign({ adminID: admin.AdminID, companyID: admin.CompanyID, username: admin.Username}, config.jwtSecret, {
            expiresIn: rememberMe ? '30d' : '8h'
        });

        res.cookie('token', token, {
            httpOnly: true,
            secure: false,
            sameSite: 'Strict',
            maxAge: rememberMe ? REMEMBER_ME_EXPIRY : SESSION_EXPIRY
        });

        return res.status(200).json({
            success: true,
            message: 'Login successfully'
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: error.message});
    }
};

export const logout = (req, res) => {
    try {
        res.clearCookie('token', {
            httpOnly: true,
            secure: false,
            sameSite: 'Strict',
        });

        return res.status(200).json({
            success: true,
            message: 'Admin Logged out'
        })
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: error.message});
    }
};