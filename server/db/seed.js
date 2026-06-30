// ============================================================
// Suraksha 2.0 — Seed Data Generator
// Generates 55 customers, 12 months of financial records with
// intentional anomalies, land records, and demo users.
// Run: node db/seed.js
// ============================================================

import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb, closeDb } from './database.js';

// ── Verhoeff Algorithm (for valid Aadhaar checksums) ────────

const VERHOEFF_D = [
    [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],
    [2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],
    [4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
    [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],
    [8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]
];
const VERHOEFF_P = [
    [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],
    [5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
    [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
    [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]
];
const VERHOEFF_INV = [0,4,3,2,1,5,6,7,8,9];

function verhoeffChecksum(num) {
    let c = 0;
    const digits = String(num).split('').reverse().map(Number);
    for (let i = 0; i < digits.length; i++) {
        c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][digits[i]]];
    }
    return VERHOEFF_INV[c];
}

function generateAadhaar() {
    // Generate 11 random digits (first can't be 0 or 1)
    const first = Math.floor(Math.random() * 8) + 2; // 2-9
    let digits = String(first);
    for (let i = 0; i < 10; i++) {
        digits += Math.floor(Math.random() * 10);
    }
    const check = verhoeffChecksum(digits);
    return digits + String(check);
}

// ── PAN Generator ───────────────────────────────────────────
function generatePAN(name) {
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const r = () => alpha[Math.floor(Math.random() * 26)];
    const n = () => Math.floor(Math.random() * 10);
    // Format: AAAAA9999A  (5 alpha, 4 digit, 1 alpha)
    // 4th char = P for individual
    const first3 = r() + r() + r();
    const last = name.charAt(0).toUpperCase() || r();
    return first3 + 'P' + last + n() + n() + n() + n() + r();
}

// ── Indian name generators ──────────────────────────────────
const FIRST_NAMES_M = [
    'Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Ayaan',
    'Krishna','Ishaan','Shaurya','Atharva','Advik','Pranav','Advaith',
    'Dhruv','Kabir','Ritvik','Aarush','Karthik','Rohan','Siddharth',
    'Vikram','Rajesh','Suresh','Mahesh','Ganesh','Ramesh','Nikhil','Amit'
];
const FIRST_NAMES_F = [
    'Aadhya','Diya','Saanvi','Ananya','Isha','Aanya','Myra','Aarohi',
    'Anika','Navya','Pari','Angel','Riya','Sara','Priya','Kavya',
    'Sneha','Pooja','Neha','Divya','Meera','Lakshmi','Sunita','Rekha',
    'Pallavi','Shruti','Nandini','Deepa','Suman','Jaya'
];
const LAST_NAMES = [
    'Sharma','Verma','Gupta','Singh','Kumar','Patel','Reddy','Nair',
    'Iyer','Joshi','Rao','Desai','Kulkarni','Menon','Pillai','Hegde',
    'Shetty','Bhat','Agarwal','Mishra','Pandey','Chauhan','Yadav',
    'Thakur','Saxena','Kapoor','Malhotra','Banerjee','Chatterjee','Das'
];
const CITIES = [
    ['Mumbai','Maharashtra'],['Delhi','Delhi'],['Bengaluru','Karnataka'],
    ['Hyderabad','Telangana'],['Chennai','Tamil Nadu'],['Pune','Maharashtra'],
    ['Ahmedabad','Gujarat'],['Kolkata','West Bengal'],['Jaipur','Rajasthan'],
    ['Lucknow','Uttar Pradesh'],['Kochi','Kerala'],['Mysuru','Karnataka'],
    ['Chandigarh','Punjab'],['Indore','Madhya Pradesh'],['Nagpur','Maharashtra']
];
const OCCUPATIONS = [
    'Software Engineer','Doctor','Teacher','Business Owner','Accountant',
    'Civil Servant','Lawyer','Architect','Farmer','Shopkeeper',
    'Bank Employee','Consultant','Freelancer','Retired','Homemaker'
];
const STREETS = [
    'MG Road','Station Road','Gandhi Nagar','Nehru Street','Tagore Lane',
    'Patel Nagar','Ambedkar Road','Rajaji Street','Shivaji Nagar','Lake View Colony'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return +(Math.random() * (max - min) + min).toFixed(2); }

function randomDate(startYear, endYear) {
    const y = randInt(startYear, endYear);
    const m = String(randInt(1, 12)).padStart(2, '0');
    const d = String(randInt(1, 28)).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ── Generate Customers ──────────────────────────────────────
function generateCustomers(count) {
    const customers = [];
    for (let i = 0; i < count; i++) {
        const gender = Math.random() > 0.45 ? 'M' : 'F';
        const firstName = gender === 'M' ? pick(FIRST_NAMES_M) : pick(FIRST_NAMES_F);
        const lastName = pick(LAST_NAMES);
        const fullName = `${firstName} ${lastName}`;
        const [city, state] = pick(CITIES);

        customers.push({
            id: randomUUID(),
            full_name: fullName,
            date_of_birth: randomDate(1960, 2000),
            gender,
            pan_number: generatePAN(lastName),
            aadhaar_number: generateAadhaar(),
            phone: `+91${randInt(70000, 99999)}${randInt(10000, 99999)}`,
            email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randInt(1,99)}@email.com`,
            address_line1: `${randInt(1,500)}, ${pick(STREETS)}`,
            address_line2: `Near ${pick(['Bus Stand','Railway Station','Temple','Market','Hospital'])}`,
            city,
            state,
            pincode: String(randInt(100000, 999999)),
            occupation: pick(OCCUPATIONS),
            annual_income: randFloat(200000, 5000000),
            risk_score: 0
        });
    }
    return customers;
}

// ── Generate Normal Financial Records ───────────────────────
function generateNormalTransactions(customerId, months = 12) {
    const records = [];
    const salary = randFloat(25000, 200000);
    const accountNum = `SB${randInt(100000000, 999999999)}`;

    for (let m = 0; m < months; m++) {
        const year = 2025 + Math.floor(m / 12);
        const month = String((m % 12) + 1).padStart(2, '0');

        // Salary credit
        records.push({
            id: randomUUID(),
            customer_id: customerId,
            record_type: 'salary',
            amount: salary + randFloat(-500, 500),
            source_account: 'EMPLOYER_ACC',
            dest_account: accountNum,
            description: 'Monthly Salary',
            transaction_date: `${year}-${month}-01`,
            reference_number: `SAL${year}${month}${randInt(1000,9999)}`
        });

        // 5-15 random debits per month
        const numDebits = randInt(5, 15);
        for (let d = 0; d < numDebits; d++) {
            const types = ['debit','emi','transfer','fee'];
            records.push({
                id: randomUUID(),
                customer_id: customerId,
                record_type: pick(types),
                amount: randFloat(100, 50000),
                source_account: accountNum,
                dest_account: `ACC${randInt(100000, 999999)}`,
                description: pick([
                    'Grocery Purchase','Electricity Bill','Mobile Recharge',
                    'EMI Payment','Online Shopping','Restaurant','Fuel',
                    'Insurance Premium','Subscription','Medical Expense'
                ]),
                transaction_date: `${year}-${month}-${String(randInt(1,28)).padStart(2,'0')}`,
                reference_number: `TXN${randomUUID().slice(0,8).toUpperCase()}`
            });
        }
    }
    return records;
}

// ── Generate Benford-violating transactions ─────────────────
// Benford's law says digit 1 should appear ~30% of the time.
// We create transactions where digits 7,8,9 dominate to violate it.
function generateBenfordViolations(customerId, months = 12) {
    const records = [];
    const accountNum = `SB${randInt(100000000, 999999999)}`;

    for (let m = 0; m < months; m++) {
        const year = 2025 + Math.floor(m / 12);
        const month = String((m % 12) + 1).padStart(2, '0');

        // 15-25 transactions with leading digits biased to 7,8,9
        const numTxns = randInt(15, 25);
        for (let t = 0; t < numTxns; t++) {
            // Force leading digit to be 7, 8, or 9 (~80% of the time)
            let amount;
            if (Math.random() < 0.80) {
                const leadDigit = pick([7, 8, 9]);
                const magnitude = pick([100, 1000, 10000]);
                amount = leadDigit * magnitude + randInt(0, magnitude - 1);
            } else {
                amount = randFloat(100, 90000);
            }

            records.push({
                id: randomUUID(),
                customer_id: customerId,
                record_type: pick(['debit', 'credit', 'transfer']),
                amount: +amount.toFixed(2),
                source_account: accountNum,
                dest_account: `ACC${randInt(100000, 999999)}`,
                description: pick([
                    'Vendor Payment','Service Charge','Commission',
                    'Supplies Purchase','Equipment Rental','Consulting Fee'
                ]),
                transaction_date: `${year}-${month}-${String(randInt(1,28)).padStart(2,'0')}`,
                reference_number: `TXN${randomUUID().slice(0,8).toUpperCase()}`,
                is_flagged: 0
            });
        }
    }
    return records;
}

// ── Generate Salami Attack pattern ──────────────────────────
// Repeated tiny deductions (₹1–₹5) from many accounts going to one destination.
function generateSalamiAttack(customerId, months = 6) {
    const records = [];
    const victimAccount = `SB${randInt(100000000, 999999999)}`;
    const salamiDest = `SALAMI_${randInt(1000, 9999)}`;
    const salamiAmount = pick([1.00, 1.50, 2.00, 2.50, 3.00, 4.00, 5.00]);

    for (let m = 0; m < months; m++) {
        const year = 2025;
        const month = String((m % 12) + 1).padStart(2, '0');

        // 20-40 tiny deductions per month
        const numSalami = randInt(20, 40);
        for (let s = 0; s < numSalami; s++) {
            records.push({
                id: randomUUID(),
                customer_id: customerId,
                record_type: 'fee',
                amount: salamiAmount,
                source_account: victimAccount,
                dest_account: salamiDest,
                description: pick([
                    'Service Charge','Processing Fee','Account Maintenance',
                    'SMS Alert Charge','Digital Fee','Convenience Fee'
                ]),
                transaction_date: `${year}-${month}-${String(randInt(1,28)).padStart(2,'0')}`,
                reference_number: `FEE${randomUUID().slice(0,8).toUpperCase()}`,
                is_flagged: 0
            });
        }

        // Also add some normal transactions to disguise
        for (let n = 0; n < randInt(3, 8); n++) {
            records.push({
                id: randomUUID(),
                customer_id: customerId,
                record_type: pick(['debit', 'credit']),
                amount: randFloat(500, 30000),
                source_account: victimAccount,
                dest_account: `ACC${randInt(100000, 999999)}`,
                description: 'Regular Transaction',
                transaction_date: `${year}-${month}-${String(randInt(1,28)).padStart(2,'0')}`,
                reference_number: `TXN${randomUUID().slice(0,8).toUpperCase()}`,
                is_flagged: 0
            });
        }
    }
    return records;
}

// ── Generate Land Records ───────────────────────────────────
const VILLAGES = ['Hoskote','Anekal','Devanahalli','Doddaballapura','Ramanagara','Channapatna','Magadi','Nelamangala'];
const TALUKS   = ['Bangalore North','Bangalore South','Anekal','Devanahalli','Doddaballapura','Ramanagara'];

function generateLandRecords(customer, matchOwner = true) {
    const numRecords = randInt(1, 3);
    const records = [];

    for (let i = 0; i < numRecords; i++) {
        const village = pick(VILLAGES);
        const taluk = pick(TALUKS);
        const area = randFloat(500, 50000);

        // Ownership chain (2-4 previous owners)
        const chainLength = randInt(2, 4);
        const ownershipChain = [];
        for (let j = 0; j < chainLength; j++) {
            ownershipChain.push({
                owner: j === chainLength - 1 && matchOwner
                    ? customer.full_name
                    : `${pick(FIRST_NAMES_M)} ${pick(LAST_NAMES)}`,
                from: `${2000 + j * 5}-01-01`,
                to: j === chainLength - 1 ? null : `${2005 + j * 5}-01-01`,
                deed_number: `DEED/${village.toUpperCase().slice(0,3)}/${2000 + j * 5}/${randInt(100,999)}`
            });
        }

        records.push({
            id: randomUUID(),
            customer_id: customer.id,
            survey_number: `${randInt(1,500)}/${randInt(1,20)}`,
            sub_division: Math.random() > 0.5 ? `${pick(['A','B','C','D'])}` : null,
            village,
            taluk,
            district: 'Bangalore Urban',
            state: 'Karnataka',
            total_area: area,
            area_unit: 'sqm',
            registered_owner: matchOwner ? customer.full_name : `${pick(FIRST_NAMES_M)} ${pick(LAST_NAMES)}`,
            previous_owner: ownershipChain.length > 1 ? ownershipChain[chainLength - 2].owner : null,
            registration_number: `REG/${randInt(2015,2025)}/${randInt(10000,99999)}`,
            registration_date: randomDate(2015, 2025),
            market_value: area * randFloat(2000, 15000),
            guideline_value: area * randFloat(1500, 10000),
            has_encumbrance: 0,
            encumbrance_details: null,
            mutation_status: pick(['completed', 'pending', 'not_applicable']),
            ownership_chain_json: JSON.stringify(ownershipChain),
            is_flagged: 0,
            flag_reason: null
        });
    }
    return records;
}

// ── Generate flagged land records (owner mismatch) ──────────
function generateFlaggedLandRecords(customer) {
    const records = generateLandRecords(customer, false); // owner won't match
    return records.map(r => ({
        ...r,
        is_flagged: 1,
        flag_reason: 'Owner name mismatch with customer record',
        has_encumbrance: Math.random() > 0.5 ? 1 : 0,
        encumbrance_details: Math.random() > 0.5 ? 'Bank lien registered — pending loan clearance' : null,
        mutation_status: pick(['pending', 'disputed'])
    }));
}

// ══════════════════════════════════════════════════════════════
// MAIN SEED FUNCTION
// ══════════════════════════════════════════════════════════════
async function seed() {
    console.log('🌱 Suraksha 2.0 — Seeding database...\n');

    const db = getDb();

    // ── Clear existing data ─────────────────────────────────
    const tables = [
        'audit_log','alerts','verification_results','documents',
        'land_records','financial_records','customers','users','system_settings'
    ];
    for (const t of tables) {
        db.prepare(`DELETE FROM ${t}`).run();
    }
    console.log('  ✓ Cleared existing data');

    // ── 1. Create demo users ────────────────────────────────
    const salt = bcrypt.genSaltSync(10);
    const users = [
        {
            id: randomUUID(), username: 'junior1',
            password_hash: bcrypt.hashSync('suraksha@123', salt),
            full_name: 'Priya Sharma', role: 'verifier',
            email: 'priya.sharma@bank.com'
        }
    ];

    const insertUser = db.prepare(`
        INSERT INTO users (id, username, password_hash, full_name, role, email)
        VALUES (@id, @username, @password_hash, @full_name, @role, @email)
    `);
    for (const u of users) insertUser.run(u);
    console.log(`  ✓ Created ${users.length} users`);

    // ── 2. Generate 55 customers ────────────────────────────
    const customers = generateCustomers(55);
    const insertCustomer = db.prepare(`
        INSERT INTO customers (id, full_name, date_of_birth, gender, pan_number,
            aadhaar_number, phone, email, address_line1, address_line2,
            city, state, pincode, occupation, annual_income, risk_score)
        VALUES (@id, @full_name, @date_of_birth, @gender, @pan_number,
            @aadhaar_number, @phone, @email, @address_line1, @address_line2,
            @city, @state, @pincode, @occupation, @annual_income, @risk_score)
    `);

    const insertMany = db.transaction((custs) => {
        for (const c of custs) insertCustomer.run(c);
    });
    insertMany(customers);
    console.log(`  ✓ Created ${customers.length} customers`);

    // ── 3. Financial Records ────────────────────────────────
    const insertTxn = db.prepare(`
        INSERT INTO financial_records (id, customer_id, record_type, amount,
            source_account, dest_account, description, transaction_date,
            reference_number, is_flagged, flag_reason)
        VALUES (@id, @customer_id, @record_type, @amount,
            @source_account, @dest_account, @description, @transaction_date,
            @reference_number, @is_flagged, @flag_reason)
    `);

    let totalTxns = 0;

    // — 3a. Normal transactions for customers 0–44
    const insertNormalBatch = db.transaction((recs) => {
        for (const r of recs) {
            insertTxn.run({ ...r, is_flagged: 0, flag_reason: null });
        }
    });
    for (let i = 0; i < 45; i++) {
        const recs = generateNormalTransactions(customers[i].id, 12);
        insertNormalBatch(recs);
        totalTxns += recs.length;
    }

    // — 3b. Benford violations for customers 45–49 (5 customers)
    const benfordCustomers = customers.slice(45, 50);
    for (const c of benfordCustomers) {
        const recs = generateBenfordViolations(c.id, 12);
        insertNormalBatch(recs);
        totalTxns += recs.length;
        c.risk_score = 65; // Pre-flag
    }
    console.log(`  ✓ Seeded Benford violations for ${benfordCustomers.length} customers`);

    // — 3c. Salami attacks for customers 50–52 (3 customers)
    const salamiCustomers = customers.slice(50, 53);
    for (const c of salamiCustomers) {
        const recs = generateSalamiAttack(c.id, 6);
        insertNormalBatch(recs);
        totalTxns += recs.length;
        c.risk_score = 80;
    }
    console.log(`  ✓ Seeded salami attack patterns for ${salamiCustomers.length} customers`);

    // — 3d. Normal transactions for remaining (53-54) just to fill
    for (let i = 53; i < 55; i++) {
        const recs = generateNormalTransactions(customers[i].id, 12);
        insertNormalBatch(recs);
        totalTxns += recs.length;
    }

    console.log(`  ✓ Created ${totalTxns} financial records`);

    // ── 4. Land Records ─────────────────────────────────────
    const insertLand = db.prepare(`
        INSERT INTO land_records (id, customer_id, survey_number, sub_division,
            village, taluk, district, state, total_area, area_unit,
            registered_owner, previous_owner, registration_number,
            registration_date, market_value, guideline_value,
            has_encumbrance, encumbrance_details, mutation_status,
            ownership_chain_json, is_flagged, flag_reason)
        VALUES (@id, @customer_id, @survey_number, @sub_division,
            @village, @taluk, @district, @state, @total_area, @area_unit,
            @registered_owner, @previous_owner, @registration_number,
            @registration_date, @market_value, @guideline_value,
            @has_encumbrance, @encumbrance_details, @mutation_status,
            @ownership_chain_json, @is_flagged, @flag_reason)
    `);

    let totalLand = 0;

    // Normal land records for first 45 customers
    const insertLandBatch = db.transaction((recs) => {
        for (const r of recs) insertLand.run(r);
    });

    for (let i = 0; i < 45; i++) {
        if (Math.random() > 0.4) { // ~60% of customers have land records
            const recs = generateLandRecords(customers[i], true);
            insertLandBatch(recs);
            totalLand += recs.length;
        }
    }

    // Flagged land records for customers 53-54 (owner mismatch)
    for (let i = 53; i < 55; i++) {
        const recs = generateFlaggedLandRecords(customers[i]);
        insertLandBatch(recs);
        totalLand += recs.length;
    }
    console.log(`  ✓ Created ${totalLand} land records (incl. flagged)`);

    // ── 5. Update risk scores ───────────────────────────────
    const updateRisk = db.prepare(`UPDATE customers SET risk_score = ? WHERE id = ?`);
    for (const c of [...benfordCustomers, ...salamiCustomers]) {
        updateRisk.run(c.risk_score, c.id);
    }
    // Flag the land-mismatch customers too
    for (let i = 53; i < 55; i++) {
        updateRisk.run(55, customers[i].id);
    }
    console.log('  ✓ Updated risk scores');

    // ── 6. System Settings ──────────────────────────────────
    const insertSetting = db.prepare(`
        INSERT INTO system_settings (key, value, description)
        VALUES (?, ?, ?)
    `);
    const settings = [
        ['benford_threshold', '0.05', 'Chi-squared p-value threshold for Benford violation'],
        ['salami_max_amount', '10', 'Maximum amount (₹) to consider as salami deduction'],
        ['salami_min_occurrences', '15', 'Minimum repeated deductions to flag salami attack'],
        ['zscore_threshold', '3.0', 'Z-score threshold for statistical outlier detection'],
        ['ela_threshold', '30', 'ELA average difference threshold for tampering flag'],
        ['jwt_expiry', '8h', 'JWT token expiry duration'],
        ['max_upload_size_mb', '25', 'Maximum file upload size in megabytes'],
        ['ocr_language', 'eng', 'Tesseract OCR language'],
        ['system_version', '2.0.0', 'Suraksha system version']
    ];
    for (const [k, v, d] of settings) {
        insertSetting.run(k, v, d);
    }
    console.log('  ✓ Inserted system settings');

    // ── 7. Seed some initial alerts ─────────────────────────
    const insertAlert = db.prepare(`
        INSERT INTO alerts (id, customer_id, alert_type, severity, title, description)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const c of benfordCustomers) {
        insertAlert.run(
            randomUUID(), c.id, 'benford_violation', 'high',
            `Benford's Law Violation — ${c.full_name}`,
            `Transaction amounts for customer ${c.full_name} show abnormal leading-digit distribution inconsistent with Benford's Law (p < 0.05). Possible fabricated or manipulated financial records.`
        );
    }
    for (const c of salamiCustomers) {
        insertAlert.run(
            randomUUID(), c.id, 'salami_attack', 'critical',
            `Salami Attack Pattern — ${c.full_name}`,
            `Detected repeated small deductions (₹1–₹5) across multiple transactions for ${c.full_name}. Pattern consistent with salami slicing fraud.`
        );
    }
    for (let i = 53; i < 55; i++) {
        insertAlert.run(
            randomUUID(), customers[i].id, 'ownership_mismatch', 'medium',
            `Land Owner Mismatch — ${customers[i].full_name}`,
            `Land record registered owner does not match customer name on file for ${customers[i].full_name}. Possible fraudulent land document submission.`
        );
    }
    console.log('  ✓ Created initial alerts');

    // ── Done ────────────────────────────────────────────────
    console.log('\n✅ Seed complete!');
    console.log('   Demo login credentials:');
    console.log('   ┌──────────────────────────────────────────┐');
    console.log('   │  junior1 / suraksha@123  (Verifier)      │');
    console.log('   └──────────────────────────────────────────┘');

    closeDb();
}

seed().catch(err => {
    console.error('❌ Seed failed:', err);
    closeDb();
    process.exit(1);
});
