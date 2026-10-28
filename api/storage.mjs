import { storageRequest } from '../server/mongo-storage.mjs';
export default {fetch:request=>storageRequest(request)};
