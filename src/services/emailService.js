import nodemailer from 'nodemailer';
import config from '../config/env.js';

const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: false,
    auth: {
        type: 'OAuth2',
        user: config.smtp.user,
        clientId: config.smtp.clientId,
        tenantId: config.smtp.tenantId,
        clientSecret: config.smtp.clientSecret
    }
});

export const sendConfirmationEmail = async ({ to, referenceNumber, username, password, loginUrl }) => {
    const mailOptions = {
        from: config.smtp.user,
        to: to,
        subject: 'This is you account credentials',
        html:  `
        <div>
            <p>${referenceNumber}</p>
            <p>${username}</p>
            <p>${password}</p>
            <p>${loginUrl}</p>
        </div>
        `
    }

    await transporter.sendMail(mailOptions)
}