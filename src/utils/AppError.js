export class AppError extends Error {
    // `errors` is optional: a map of field name to sentence, for a refusal that names several
    // fields (the details of a claim). The error handler sends it beside the message.
    constructor(message, statusCode, errors) {
        super(message);
        this.statusCode = statusCode;
        if (errors) this.errors = errors;
    }
}