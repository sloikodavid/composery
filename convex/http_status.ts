/** HTTP status codes from RFC 9110 that this backend sends or reads. */
export const httpStatus = {
	noContent: 204,
	badRequest: 400,
	unauthorized: 401,
	forbidden: 403,
	notFound: 404,
	requestTimeout: 408,
	conflict: 409,
	preconditionFailed: 412,
	contentTooLarge: 413,
	locked: 423,
	tooManyRequests: 429,
	internalServerError: 500,
	serviceUnavailable: 503,
} as const;

const clientErrorStart = 400;
const serverErrorStart = 500;
const serverErrorEnd = 600;

export function isHttpClientError(status: number) {
	return status >= clientErrorStart && status < serverErrorStart;
}

export function isHttpServerError(status: number) {
	return status >= serverErrorStart && status < serverErrorEnd;
}
