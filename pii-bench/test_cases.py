"""
PII test cases with ground-truth annotations.

Each test case is a dict with:
  - id:    short identifier
  - text:  the raw input text
  - pii:   list of dicts, each with:
      - value: the exact PII string that should be redacted
      - type:  PII category (PERSON, EMAIL, PHONE, SSN, CREDIT_CARD, ADDRESS, IP, URL, DATE_OF_BIRTH, etc.)
"""

TEST_CASES = [
    # ── 1. Basic names ──────────────────────────────────────────────
    {
        "id": "name_simple",
        "text": "Please contact John Smith for more information about the project.",
        "pii": [
            {"value": "John Smith", "type": "PERSON"},
        ],
    },
    {
        "id": "name_multiple",
        "text": "The meeting between Sarah Johnson and Michael Chen was scheduled by their manager David Williams.",
        "pii": [
            {"value": "Sarah Johnson", "type": "PERSON"},
            {"value": "Michael Chen", "type": "PERSON"},
            {"value": "David Williams", "type": "PERSON"},
        ],
    },
    {
        "id": "name_non_western",
        "text": "Dr. Hiroshi Tanaka and Prof. Aisha Patel co-authored the paper with Carlos García.",
        "pii": [
            {"value": "Hiroshi Tanaka", "type": "PERSON"},
            {"value": "Aisha Patel", "type": "PERSON"},
            {"value": "Carlos García", "type": "PERSON"},
        ],
    },
    # ── 2. Email addresses ──────────────────────────────────────────
    {
        "id": "email_simple",
        "text": "Send your resume to hiring@acmecorp.com or john.doe@gmail.com.",
        "pii": [
            {"value": "hiring@acmecorp.com", "type": "EMAIL"},
            {"value": "john.doe@gmail.com", "type": "EMAIL"},
        ],
    },
    {
        "id": "email_in_sentence",
        "text": "You can reach me at alice.wonderland+work@company.co.uk for any follow-ups.",
        "pii": [
            {"value": "alice.wonderland+work@company.co.uk", "type": "EMAIL"},
        ],
    },
    # ── 3. Phone numbers ────────────────────────────────────────────
    {
        "id": "phone_us_formats",
        "text": "Call us at (555) 123-4567 or 555.987.6543. Fax: 1-800-555-0199.",
        "pii": [
            {"value": "(555) 123-4567", "type": "PHONE"},
            {"value": "555.987.6543", "type": "PHONE"},
            {"value": "1-800-555-0199", "type": "PHONE"},
        ],
    },
    {
        "id": "phone_international",
        "text": "His UK mobile is +44 7911 123456 and her German office line is +49 30 901820.",
        "pii": [
            {"value": "+44 7911 123456", "type": "PHONE"},
            {"value": "+49 30 901820", "type": "PHONE"},
        ],
    },
    # ── 4. SSN ──────────────────────────────────────────────────────
    {
        "id": "ssn_basic",
        "text": "Applicant SSN: 123-45-6789. Please verify with the records department.",
        "pii": [
            {"value": "123-45-6789", "type": "SSN"},
        ],
    },
    {
        "id": "ssn_no_dashes",
        "text": "Social security number on file is 987654321 for the primary account holder.",
        "pii": [
            {"value": "987654321", "type": "SSN"},
        ],
    },
    # ── 5. Credit card numbers ──────────────────────────────────────
    {
        "id": "cc_visa",
        "text": "Payment processed on Visa card 4111-1111-1111-1111, exp 09/27.",
        "pii": [
            {"value": "4111-1111-1111-1111", "type": "CREDIT_CARD"},
        ],
    },
    {
        "id": "cc_spaces",
        "text": "Please charge the amount to 5500 0000 0000 0004 (Mastercard).",
        "pii": [
            {"value": "5500 0000 0000 0004", "type": "CREDIT_CARD"},
        ],
    },
    # ── 6. Physical addresses ───────────────────────────────────────
    {
        "id": "address_us",
        "text": "Ship the package to 1234 Elm Street, Apt 5B, Springfield, IL 62704.",
        "pii": [
            {"value": "1234 Elm Street, Apt 5B, Springfield, IL 62704", "type": "ADDRESS"},
        ],
    },
    {
        "id": "address_uk",
        "text": "Our London office is at 42 Baker Street, London NW1 6XE, United Kingdom.",
        "pii": [
            {"value": "42 Baker Street, London NW1 6XE, United Kingdom", "type": "ADDRESS"},
        ],
    },
    # ── 7. IP addresses ─────────────────────────────────────────────
    {
        "id": "ip_v4",
        "text": "The server at 192.168.1.105 is unreachable. Try 10.0.0.1 instead.",
        "pii": [
            {"value": "192.168.1.105", "type": "IP_ADDRESS"},
            {"value": "10.0.0.1", "type": "IP_ADDRESS"},
        ],
    },
    # ── 8. Dates of birth ───────────────────────────────────────────
    {
        "id": "dob_formats",
        "text": "Patient DOB: 03/15/1990. Secondary contact born on January 2, 1985.",
        "pii": [
            {"value": "03/15/1990", "type": "DATE_OF_BIRTH"},
            {"value": "January 2, 1985", "type": "DATE_OF_BIRTH"},
        ],
    },
    # ── 9. URLs with personal info ──────────────────────────────────
    {
        "id": "url_personal",
        "text": "Check my profile at https://linkedin.com/in/janesmith92 or http://janesmith.com/resume.",
        "pii": [
            {"value": "https://linkedin.com/in/janesmith92", "type": "URL"},
            {"value": "http://janesmith.com/resume", "type": "URL"},
        ],
    },
    # ── 10. Mixed PII – formal letter ──────────────────────────────
    {
        "id": "mixed_formal_letter",
        "text": (
            "Dear Mr. Robert Anderson,\n\n"
            "Thank you for your application dated February 10, 2025. "
            "We have your Social Security Number (078-05-1120) and date of birth "
            "(07/22/1988) on file. For correspondence, we will use your email "
            "robert.anderson@outlook.com and phone number (312) 555-0178.\n\n"
            "Your billing address is 789 Oak Avenue, Suite 200, Chicago, IL 60601.\n\n"
            "Sincerely,\nEmma Watson\nHR Director"
        ),
        "pii": [
            {"value": "Robert Anderson", "type": "PERSON"},
            {"value": "078-05-1120", "type": "SSN"},
            {"value": "07/22/1988", "type": "DATE_OF_BIRTH"},
            {"value": "robert.anderson@outlook.com", "type": "EMAIL"},
            {"value": "(312) 555-0178", "type": "PHONE"},
            {"value": "789 Oak Avenue, Suite 200, Chicago, IL 60601", "type": "ADDRESS"},
            {"value": "Emma Watson", "type": "PERSON"},
        ],
    },
    # ── 11. Mixed PII – casual chat ────────────────────────────────
    {
        "id": "mixed_casual_chat",
        "text": (
            "hey can you send it to my email lisa.m@yahoo.com? my number is 415-555-0132 "
            "btw. oh and my address is 55 Market St, San Francisco CA 94105. thx!!"
        ),
        "pii": [
            {"value": "lisa.m@yahoo.com", "type": "EMAIL"},
            {"value": "415-555-0132", "type": "PHONE"},
            {"value": "55 Market St, San Francisco CA 94105", "type": "ADDRESS"},
        ],
    },
    # ── 12. Mixed PII – medical note ───────────────────────────────
    {
        "id": "mixed_medical",
        "text": (
            "Patient: James O'Brien, DOB: 11/30/1975, MRN: 4829301.\n"
            "Diagnosis: Type 2 Diabetes. Prescribed Metformin 500mg.\n"
            "Emergency contact: Mary O'Brien, phone: (617) 555-0245.\n"
            "Insurance ID: BC-9938271-A. PCP: Dr. Patricia Nguyen."
        ),
        "pii": [
            {"value": "James O'Brien", "type": "PERSON"},
            {"value": "11/30/1975", "type": "DATE_OF_BIRTH"},
            {"value": "4829301", "type": "MEDICAL_RECORD"},
            {"value": "Mary O'Brien", "type": "PERSON"},
            {"value": "(617) 555-0245", "type": "PHONE"},
            {"value": "BC-9938271-A", "type": "INSURANCE_ID"},
            {"value": "Patricia Nguyen", "type": "PERSON"},
        ],
    },
    # ── 13. Mixed PII – financial table ────────────────────────────
    {
        "id": "mixed_financial_table",
        "text": (
            "Account Holder: William Park\n"
            "Account Number: 2839104857\n"
            "Routing Number: 021000021\n"
            "SSN: 219-09-9999\n"
            "Email: william.park@bankmail.com\n"
            "Phone: +1 (202) 555-0143\n"
            "Credit Card: 4532 0151 1283 0366\n"
        ),
        "pii": [
            {"value": "William Park", "type": "PERSON"},
            {"value": "2839104857", "type": "BANK_ACCOUNT"},
            {"value": "021000021", "type": "ROUTING_NUMBER"},
            {"value": "219-09-9999", "type": "SSN"},
            {"value": "william.park@bankmail.com", "type": "EMAIL"},
            {"value": "+1 (202) 555-0143", "type": "PHONE"},
            {"value": "4532 0151 1283 0366", "type": "CREDIT_CARD"},
        ],
    },
    # ── 14. Edge case – PII-like non-PII ───────────────────────────
    {
        "id": "edge_false_positive",
        "text": (
            "The Johnson & Johnson company reported Q3 earnings of $5.2 billion. "
            "Version 2.0.1 was released on March 2024. "
            "The building at 1600 Pennsylvania Avenue is a national landmark."
        ),
        "pii": [],  # No real PII — tests false positive rate
    },
    # ── 15. Edge case – dense PII paragraph ────────────────────────
    {
        "id": "edge_dense_pii",
        "text": (
            "Name: Elena Rodriguez, SSN: 321-54-9876, DOB: 04/18/1992, "
            "Email: elena.r@protonmail.com, Phone: (786) 555-0199, "
            "Address: 1010 Brickell Ave, Miami, FL 33131, "
            "Passport: X12345678, DL: R123-4567-8901."
        ),
        "pii": [
            {"value": "Elena Rodriguez", "type": "PERSON"},
            {"value": "321-54-9876", "type": "SSN"},
            {"value": "04/18/1992", "type": "DATE_OF_BIRTH"},
            {"value": "elena.r@protonmail.com", "type": "EMAIL"},
            {"value": "(786) 555-0199", "type": "PHONE"},
            {"value": "1010 Brickell Ave, Miami, FL 33131", "type": "ADDRESS"},
            {"value": "X12345678", "type": "PASSPORT"},
            {"value": "R123-4567-8901", "type": "DRIVERS_LICENSE"},
        ],
    },
    # ── 16. Edge case – PII inside code/JSON ───────────────────────
    {
        "id": "edge_pii_in_code",
        "text": (
            '{"user": {"name": "Tom Brady", "email": "tom.brady@example.com", '
            '"ssn": "111-22-3333", "phone": "5085551234"}}'
        ),
        "pii": [
            {"value": "Tom Brady", "type": "PERSON"},
            {"value": "tom.brady@example.com", "type": "EMAIL"},
            {"value": "111-22-3333", "type": "SSN"},
            {"value": "5085551234", "type": "PHONE"},
        ],
    },
    # ── 17. Edge case – multi-line legal document ──────────────────
    {
        "id": "edge_legal_doc",
        "text": (
            "LEASE AGREEMENT\n\n"
            "This Lease Agreement is entered into on December 1, 2024 by and between:\n\n"
            "Landlord: Gregory Foster, residing at 500 Maple Drive, Austin, TX 78701\n"
            "Phone: (512) 555-0167, Email: g.foster@realestate.com\n\n"
            "Tenant: Sophia Martinez, SSN: 456-78-9012\n"
            "Current Address: 234 Pine Road, Unit 12, Austin, TX 78702\n"
            "Phone: (512) 555-0234, Email: sophia.m@gmail.com\n\n"
            "The monthly rent shall be $2,150.00 payable on the 1st of each month.\n"
        ),
        "pii": [
            {"value": "Gregory Foster", "type": "PERSON"},
            {"value": "500 Maple Drive, Austin, TX 78701", "type": "ADDRESS"},
            {"value": "(512) 555-0167", "type": "PHONE"},
            {"value": "g.foster@realestate.com", "type": "EMAIL"},
            {"value": "Sophia Martinez", "type": "PERSON"},
            {"value": "456-78-9012", "type": "SSN"},
            {"value": "234 Pine Road, Unit 12, Austin, TX 78702", "type": "ADDRESS"},
            {"value": "(512) 555-0234", "type": "PHONE"},
            {"value": "sophia.m@gmail.com", "type": "EMAIL"},
        ],
    },
    # ── 18. Edge case – names that are also common words ───────────
    {
        "id": "edge_ambiguous_names",
        "text": (
            "Bill Brown reviewed the bill for the brown leather couch. "
            "Grace Park walked through Grace Park on her way to work. "
            "Mark Price put a mark on the price tag."
        ),
        "pii": [
            {"value": "Bill Brown", "type": "PERSON"},
            {"value": "Grace Park", "type": "PERSON"},
            {"value": "Mark Price", "type": "PERSON"},
        ],
    },
    # ── 19. Edge case – redacting within a table/CSV-like format ───
    {
        "id": "edge_csv_like",
        "text": (
            "Name,Email,Phone,SSN\n"
            "Alice Wong,alice.w@corp.io,650-555-0111,123-45-6789\n"
            "Bob Marley,bob.m@music.com,310-555-0222,987-65-4321\n"
            "Clara Schumann,clara.s@piano.org,212-555-0333,456-12-7890\n"
        ),
        "pii": [
            {"value": "Alice Wong", "type": "PERSON"},
            {"value": "alice.w@corp.io", "type": "EMAIL"},
            {"value": "650-555-0111", "type": "PHONE"},
            {"value": "123-45-6789", "type": "SSN"},
            {"value": "Bob Marley", "type": "PERSON"},
            {"value": "bob.m@music.com", "type": "EMAIL"},
            {"value": "310-555-0222", "type": "PHONE"},
            {"value": "987-65-4321", "type": "SSN"},
            {"value": "Clara Schumann", "type": "PERSON"},
            {"value": "clara.s@piano.org", "type": "EMAIL"},
            {"value": "212-555-0333", "type": "PHONE"},
            {"value": "456-12-7890", "type": "SSN"},
        ],
    },
    # ── 20. Realistic – support ticket ─────────────────────────────
    {
        "id": "realistic_support_ticket",
        "text": (
            "Ticket #48291 — Submitted by Kevin Liu (kevin.liu@techstartup.io)\n\n"
            "Hi, I'm having trouble logging into my account. I've tried resetting "
            "my password but the email never arrives. My account email is "
            "kevin.liu@techstartup.io and my phone on file is 408-555-0176.\n\n"
            "My billing address is 2000 El Camino Real, Santa Clara, CA 95050. "
            "The last four digits of my card are 4242. My full card number is "
            "4242 4242 4242 4242 if that helps verify me.\n\n"
            "Thanks,\nKevin Liu"
        ),
        "pii": [
            {"value": "Kevin Liu", "type": "PERSON"},
            {"value": "kevin.liu@techstartup.io", "type": "EMAIL"},
            {"value": "408-555-0176", "type": "PHONE"},
            {"value": "2000 El Camino Real, Santa Clara, CA 95050", "type": "ADDRESS"},
            {"value": "4242 4242 4242 4242", "type": "CREDIT_CARD"},
        ],
    },
]

