"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
require("dotenv/config");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const client_1 = require("@prisma/client");
const crypto_utils_1 = require("../utils/crypto.utils");
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
// Helper to encrypt query inputs for User model
const encryptUserInputs = (args) => {
    if (!args)
        return args;
    // Encrypt phone number in where clauses
    if (args.where) {
        if (typeof args.where.phoneNumber === 'string') {
            args.where.phoneNumber = (0, crypto_utils_1.encrypt)(args.where.phoneNumber);
        }
        else if (args.where.phoneNumber?.equals) {
            args.where.phoneNumber.equals = (0, crypto_utils_1.encrypt)(args.where.phoneNumber.equals);
        }
        else if (args.where.phoneNumber?.in) {
            args.where.phoneNumber.in = args.where.phoneNumber.in.map((p) => (0, crypto_utils_1.encrypt)(p));
        }
    }
    // Encrypt phone number and upiId in data clauses (create/update)
    if (args.data) {
        if (typeof args.data.phoneNumber === 'string') {
            args.data.phoneNumber = (0, crypto_utils_1.encrypt)(args.data.phoneNumber);
        }
        if (typeof args.data.upiId === 'string') {
            args.data.upiId = (0, crypto_utils_1.encrypt)(args.data.upiId);
        }
    }
    return args;
};
const basePrisma = new client_1.PrismaClient({ adapter, errorFormat: 'minimal' });
exports.prisma = basePrisma.$extends({
    result: {
        user: {
            phoneNumber: {
                needs: { phoneNumber: true },
                compute(user) {
                    return (0, crypto_utils_1.decrypt)(user.phoneNumber);
                }
            },
            upiId: {
                needs: { upiId: true },
                compute(user) {
                    return user.upiId ? (0, crypto_utils_1.decrypt)(user.upiId) : null;
                }
            }
        }
    },
    query: {
        user: {
            async findUnique({ args, query }) {
                args = encryptUserInputs(args);
                return query(args);
            },
            async findFirst({ args, query }) {
                args = encryptUserInputs(args);
                return query(args);
            },
            async findMany({ args, query }) {
                args = encryptUserInputs(args);
                return query(args);
            },
            async create({ args, query }) {
                args = encryptUserInputs(args);
                return query(args);
            },
            async update({ args, query }) {
                args = encryptUserInputs(args);
                return query(args);
            },
            async upsert({ args, query }) {
                args = encryptUserInputs(args);
                return query(args);
            }
        }
    }
});
