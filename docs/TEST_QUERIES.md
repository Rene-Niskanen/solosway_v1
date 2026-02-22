# Test Queries (semantic / vector search)

Queries are grouped by document. Use for retrieval and chat testing.

---

## Documents in database

Actual list from Supabase (run `python scripts/list_document_filenames.py` to refresh).

### Property / deal documents (have dedicated query sections below)

| Document / entity | Filenames |
|-------------------|-----------|
| **Banda Lane** | `Offer_letter_for_Banda_Lane_Final-1.pdf`, `Letter_of_Offer_Chandni_Solenki_on_Banda_Lane.docx` |
| **24 Rudthorpe Road** | `Offer_letter_for_24_Rudthorpe_Road_Final-1.pdf`, `24_Rudthorpe_Road_-_Inventory_22-07-2024_an9SoYL_1.pdf` |
| **Koch Sales** | `Koch_Sales_Market_Appraisal_-_2023.pdf` |
| **Knight Frank** | `Knight_Frank_Residential_Letting_Agreement_-_2024_-_Updated.pdf`, `Knight_Frank_Residential_Letting_Agreement_-_2024_-_March_24.pdf`, `Knight_Frank_Non-Exclusive_Agency_Sales_Agreement_-_2024_-_Mar24.pdf`, `Knight_Frank_Joint_Agency_Sales_Agreement_-_2024_-_Mar24.pdf` |
| **Nzohe LR 1160 750** | `Fully_Signed_Lease_Agreement_Nzohe_LR_1160_750_28TH_FEB_2023.pdf` |
| **Kenyajui / Espindola Mellifera** | `LEASE_AGREEMENT_BETWEEN_KENYAJUI__ESPINDOLA_MELLIFERA.pdf`, `LEASE_AGREEMENT_BETWEEN_KENYAJUI__ESPINDOLA_MELLIFERA.doc` |
| **Highlands Berden Bishops Stortford** | `Highlands_Berden_Bishops_Stortford_CM23_1AB_-_Final_2.pdf` |
| **Mbagathi Ridge No 10 Karen** | `Mbagathi_Ridge_No_10_Karen_Particulars.pdf` |
| **Development property** | `valuation-of-development-property---first-edition.pdf`, `Valuation_of_development_property_ready_for_approvals.pdf` |

### Other documents in database (no dedicated query section)

- `VAL_T_-_GENEVA_AIRPORT_TRANSFER.pdf`
- `EGYPT_AIR_KENYA.pdf`
- `FTNEA2023001.pdf`
- `Valuation_Report_Framework_2025.pdf`
- `Red-Book-Global-Standards-incorporating-IVS.pdf`
- `kenya-buying-guide-residential-10853.pdf`
- `Fidelo_inspection_check_list.pdf`
- `Boarding_Pass_Geneva_Updated.pdf`
- `Merlin_House_Site_Visit_Photos.pdf`
- `Stable_Coin_Bill_US_2025.pdf`
- `End_of_Tenancy_check_list_-_WW_1.pdf`
- `WINKWORTH_CONTRACTOR_LIST.pdf`
- `startup_technical_guide_ai_agents_final.pdf`
- `Responsible_use_of_AI_v3_consultation_final.pdf`

### Fake / sample queries for other documents (test retrieval)

Use these to check that the system can find and answer from the “other” docs.

- **Geneva airport transfer:** What does the Geneva airport transfer document say about pickup time or cost? Where is the transfer to and from?
- **Egypt Air Kenya:** What flight or route does the Egypt Air Kenya document cover? Is there a booking reference or date?
- **FTNEA2023001:** What is document FTNEA2023001 about? Who issued it and when?
- **Valuation Report Framework 2025:** What does the 2025 valuation report framework require or recommend? What sections or standards does it define?
- **Red Book / IVS:** What are the Red Book or IVS global standards for valuation? What does the document say about methodology?
- **Kenya buying guide residential:** What does the Kenya residential buying guide say about stamp duty or foreign buyers? What are the main steps for buying in Kenya?
- **Fidelo inspection checklist:** What items are on the Fidelo inspection check list? Who uses it and when?
- **Boarding pass Geneva:** What flight or date is on the Geneva boarding pass? Who is the passenger?
- **Merlin House site visit:** What does the Merlin House site visit document show? What condition or features are mentioned?
- **Stable Coin Bill US 2025:** What does the US 2025 stablecoin bill propose? Who is responsible for oversight?
- **End of tenancy checklist WW:** What is on the Winkworth end of tenancy check list? What does the tenant need to do before handover?
- **Winkworth contractor list:** What contractors are on the Winkworth list? What trades or services do they cover?
- **Startup technical guide AI agents:** What does the startup technical guide say about building AI agents? What stack or architecture does it recommend?
- **Responsible use of AI consultation:** What does the responsible use of AI consultation document recommend? What risks or principles does it mention?

---

## Favourite queries

- What is the offer value or price for Banda Lane?
- Summarise the Banda Lane offer in a few sentences
- What are the lease terms and rent in the Nzohe LR 1160 750 agreement?
- What did the Koch Sales appraisal value the property at?
- Compare the Banda Lane and 24 Rudthorpe Road offers
- When was the 24 Rudthorpe Road inventory dated and who signed it?
- What is in the inventory for 24 Rudthorpe Road?
- Who are the parties in the Kenyajui Espindola Mellifera lease?
- What does the Knight Frank letting agreement say about break clauses?
- What are the key details or asking price for Mbagathi Ridge No 10 Karen?
- What did the Highlands Berden Bishops Stortford valuation conclude?
- What payment schedule or deposit is required in the Banda Lane offer?
- What are the main terms of the offer on Banda Lane?
- What did the development property valuation recommend or value at?
- What documents do we have that mention Banda Lane?
- What is the purchase price and completion date for 24 Rudthorpe Road?
- What does the offer letter for 24 Rudthorpe Road say about the sale price?
- What fixtures and fittings are included at 24 Rudthorpe Road?
- What is the commission structure in the Knight Frank joint agency agreement?
- Who pays commission in the Knight Frank sales agreement and when?
- When does the Nzohe LR 1160 750 lease start and end?
- What is the rent and payment frequency in the Kenyajui Espindola Mellifera lease?
- Where is Mbagathi Ridge No 10 Karen located and what size is it?
- What did the development property valuation say about planning or approvals?
- What lease documents do we have and what do they cover?
- What valuation or appraisal documents do we have and what do they value?
- What documents mention 24 Rudthorpe Road?
- Is the Banda Lane offer subject to any conditions or still subject to contract?
- When can we expect to exchange or complete on 24 Rudthorpe Road?
- What’s the guide price or asking price for Mbagathi Ridge No 10 Karen?
- Are there any defects or condition issues I should flag for 24 Rudthorpe Road?
- When does the Nzohe lease expire and is the tenant likely to renew?
- Is the Knight Frank instruction exclusive or joint agency and for how long?
- What comparables does the Koch Sales appraisal use to support the value?
- What’s the EPC or energy rating in the valuation reports?
- What’s included in the sale at 24 Rudthorpe Road—fixtures, fittings, white goods?
- Does the Knight Frank letting have a break clause so we can remarket?
- What notice does the tenant need to give in the Kenyajui lease?
- What yield or investment return does the Koch Sales appraisal suggest?
- Summarise what we have on file for Banda Lane so I can brief the client
- What’s the status of the offer on 24 Rudthorpe Road—price, completion, any chain?
- Who signed the Nzohe lease?
- Anything about pets in the Knight Frank tenancy?
- Banda Lane—who’s the buyer?
- What’s the land reference for Nzohe?
- Tell me about the Karen property
- Any penalty for late completion on Banda Lane?
- Rent review in the Kenyajui lease?
- What did the valuer say about Highlands Berden?
- Anything on subletting in the Nzohe agreement?
- Mbagathi Ridge—freehold or leasehold?
- Who’s the landlord on the Knight Frank let?
- Development valuation—what’s the GDV?
- 24 Rudthorpe Road condition?
- Banda Lane deposit amount?
- Kenyajui and Espindola—which one’s the tenant?
- Koch Sales—what property is it for?
- Break option in the Nzohe lease?
- What’s in the Rudthorpe Road offer?
- Any service charge in the Nzohe lease?

---

## Banda Lane (Chandni Solenki / offer letters)

- What is the offer value or price in the Chandni Solenki Banda Lane offer?
- What are the main terms of the offer on Banda Lane?
- Conditions or special terms in the Banda Lane offer
- What is the payment schedule or deposit in the Banda Lane offer?
- What is the total purchase price for Banda Lane in the Chandni Solenki offer?
- Who made the offer on Banda Lane and what is their contact details?
- What deposit or upfront payment is required in the Banda Lane offer?
- What are the payment milestones or instalments for Banda Lane?
- Is there a completion date or timeline in the Banda Lane offer?
- What conditions precedent or subject-to clauses are in the Banda Lane offer?
- What is the total consideration or deal value across the Banda Lane offer?
- Are there any penalty clauses or late payment terms in the Banda Lane offer?
- What are the key differences between the two Banda Lane offer documents?
- Summarise the Banda Lane offer in a few sentences

---

## 24 Rudthorpe Road (offer & inventory)

- Purchase price and completion date for 24 Rudthorpe Road
- What is in the inventory for 24 Rudthorpe Road?
- What special conditions or clauses are in the 24 Rudthorpe Road offer?
- What does the offer letter for 24 Rudthorpe Road say about the sale price?
- What fixtures and fittings are included at 24 Rudthorpe Road?
- What is the condition of the property at 24 Rudthorpe Road per the inventory?
- When was the 24 Rudthorpe Road inventory dated and who signed it?
- What happens if completion is delayed in the 24 Rudthorpe Road offer?
- What survey or condition report exists for 24 Rudthorpe Road?
- Summarise the 24 Rudthorpe Road offer and inventory

---

## Koch Sales Market Appraisal (2023)

- What is the market value in the Koch Sales appraisal?
- What comparable sales or methodology does the Koch Sales appraisal use?
- What recommended value or valuation figure does the Koch Sales appraisal give?
- What assumptions or disclaimers does the Koch Sales appraisal include?
- What is the property address and description in the Koch Sales appraisal?
- What date is on the Koch Sales market appraisal 2023?
- What yield or investment return does the Koch Sales appraisal mention?

---

## Highlands Berden Bishops Stortford (valuation)

- What did Highlands Berden Bishops Stortford value at?
- What did the valuer conclude about the Highlands Berden Bishops Stortford property?
- What is the address and postcode for the Highlands Berden valuation?
- What size or type of property is Highlands Berden Bishops Stortford?
- What is the tenure or title for the property in the Highlands Berden report?
- What comparable evidence is cited in the Highlands Berden valuation?
- What is the effective date of the Highlands Berden Bishops Stortford valuation?

---

## Nzohe LR 1160 750 (lease agreement)

- What are the lease terms in the Nzohe LR 1160 750 agreement?
- What rent or term length is in the Nzohe lease?
- When does the Nzohe LR 1160 750 lease start and end?
- How much is the rent in the Nzohe LR 1160 750 lease?
- What is the security deposit in the Nzohe lease agreement?
- Who is the lessor and lessee in the Nzohe LR 1160 750 agreement?
- Does the Nzohe lease allow subletting or assignment?
- What are the renewal or extension options in the Nzohe lease?
- What repair and maintenance obligations are in the Nzohe lease?
- When was the Nzohe LR 1160 750 lease signed?
- What is the land reference number or parcel in the Nzohe lease?
- What service charge or ground rent applies in the Nzohe lease?
- What use is the property put to under the Nzohe lease (residential, commercial)?
- What happens on expiry of the Nzohe LR 1160 750 lease?

---

## Kenyajui / Espindola Mellifera (lease agreement)

- Who are the parties in the Kenyajui Espindola Mellifera lease?
- Who is the landlord and who is the tenant in the Kenyajui Espindola Mellifera lease?
- Who are Kenyajui and Espindola Mellifera in the lease?
- What is the rent and payment frequency in the Kenyajui Espindola Mellifera lease?
- What is the term or duration of the Kenyajui lease?
- What are the use restrictions in the Kenyajui Espindola Mellifera lease?
- Does the Kenyajui lease have a break option or early termination?
- What insurance obligations are in the Kenyajui lease?
- What governing law applies to the Kenyajui Espindola Mellifera lease?
- What dispute resolution or arbitration is in the Kenyajui lease?

---

## Knight Frank (letting agreement)

- What does the Knight Frank letting agreement say about break clauses?
- What are the notice periods in the Knight Frank letting agreement?
- What does the Knight Frank letting agreement say about rent increases?
- What is the initial term and any renewal in the Knight Frank letting agreement?
- What are the tenant’s obligations in the Knight Frank residential letting agreement?
- What are the landlord’s obligations in the Knight Frank letting agreement?
- What does the Knight Frank letting agreement say about pets or smoking?
- What check-in and check-out obligations are in the Knight Frank letting agreement?
- What is the notice period for the landlord to access the property in the Knight Frank letting?
- What is the security deposit or holding deposit in the Knight Frank residential letting agreement?
- What does the Knight Frank letting say about damage, repairs and dilapidations?
- Are utilities and council tax the tenant’s responsibility in the Knight Frank let?
- What happens if the tenant wants to leave early under the Knight Frank letting?
- Does the Knight Frank letting agreement require an inventory or schedule of condition?
- What rent payment frequency and method does the Knight Frank letting specify?
- What insurance does the Knight Frank letting require from landlord or tenant?
- Is the Knight Frank residential letting agreement the 2024 updated version or March 24 version?
- What are the penalties or interest for late rent in the Knight Frank letting?

---

## Knight Frank (agency / sales agreements)

- What does the Knight Frank joint agency agreement say about commission?
- What does the Knight Frank non-exclusive agency agreement say about exclusivity?
- What is the commission structure in the Knight Frank joint agency agreement?
- Who pays commission in the Knight Frank sales agreement and when?
- What marketing or listing obligations are in the Knight Frank agency agreement?
- How long is the sole agency or joint agency period in the Knight Frank sales agreement?
- What happens if the property is sold by another agent in the Knight Frank agreement?
- List all Knight Frank agreements and what each one is for
- What is the commission percentage or fee in the Knight Frank joint agency agreement?
- What is the difference between the Knight Frank non-exclusive and joint agency agreements?
- Can the vendor withdraw from the Knight Frank agency agreement and on what terms?
- What marketing materials or advertising does Knight Frank require under the agency agreement?
- When is commission due in the Knight Frank sales agreement—on exchange or completion?
- Does the Knight Frank agreement cover sale by the owner or another agent (introduction period)?
- What property or instruction do the Knight Frank 2024 Mar24 agreements relate to?
- How do I know if we have sole, joint or non-exclusive agency with Knight Frank?

---

## Mbagathi Ridge No 10 Karen (particulars)

- What are the key details or features of Mbagathi Ridge No 10 Karen?
- What are the key selling points or description of Mbagathi Ridge No 10 Karen?
- What is the asking price or value for Mbagathi Ridge No 10 Karen?
- What size, plot or acreage is Mbagathi Ridge No 10 Karen?
- Where is Mbagathi Ridge No 10 Karen located?
- What view or aspect does Mbagathi Ridge No 10 Karen have?
- What amenities or services are mentioned for Mbagathi Ridge No 10 Karen?
- Is Mbagathi Ridge No 10 Karen freehold or leasehold?

---

## Development property (valuation ready for approvals)

- What did the development property valuation recommend or value at?
- What did the development property valuation say about planning or approvals?
- What is the development value or GDV in the valuation of development property?
- What assumptions does the development property valuation make?
- What is the recommended next step in the development property valuation?
- What is the target or achievable value in the development property valuation?
- What planning status or consent does the development property valuation assume?
- What risks or caveats does the development property valuation mention?

---

## Queries targeting other documents (24 Rudthorpe Road, Highlands Berden, Kenyajui, Mbagathi Ridge, development)

Use these to test retrieval and answers against documents other than Banda Lane, Koch Sales, Knight Frank and Nzohe.

### 24 Rudthorpe Road
- What evidence or comparables back up the 24 Rudthorpe Road sale price?
- Is there a completion deadline in the 24 Rudthorpe Road paperwork?
- What fee or commission does the 24 Rudthorpe Road sale involve?
- When does the 24 Rudthorpe Road offer expire and who drafted it?
- What fixtures and fittings are included at 24 Rudthorpe Road and what state are they in?
- What yield or investment return is implied by the 24 Rudthorpe Road figures?

### Highlands Berden Bishops Stortford (valuation)
- What evidence or comparables back up the Highlands Berden valuation?
- Is there an effective date or deadline in the Highlands Berden report?
- What fee or basis does the Highlands Berden valuer use?
- When was the Highlands Berden valuation produced and who drafted it?
- What is the property address and tenure in the Highlands Berden paperwork?
- What yield or investment return does the Highlands Berden valuation suggest?

### Kenyajui / Espindola Mellifera (lease)
- What evidence or guarantees back up the Kenyajui Espindola Mellifera lease?
- Is there a break or completion deadline in the Kenyajui lease?
- What fee, deposit or commission is mentioned in the Kenyajui Espindola Mellifera lease?
- When does the Kenyajui lease start and end and who drafted it?
- When does the Kenyajui Espindola Mellifera lease run until?
- What yield, rent or investment return does the Kenyajui lease suggest?

### Mbagathi Ridge No 10 Karen
- What evidence or comparables support the Mbagathi Ridge No 10 Karen asking price?
- Is there a deadline or listing period for Mbagathi Ridge No 10 Karen?
- What fee or commission applies to a sale of Mbagathi Ridge No 10 Karen?
- When was the Mbagathi Ridge Karen particulars drafted and by whom?
- What are the key terms—freehold/leasehold, size, location—for Mbagathi Ridge No 10 Karen?
- What yield or investment angle does the Mbagathi Ridge Karen marketing suggest?

### Development property (valuation)
- What evidence or comparables back up the development property valuation?
- Is there a planning or completion deadline in the development valuation?
- What fee or valuation basis does the development property report use?
- When was the development property valuation produced and who drafted it?
- What GDV or end value does the development property valuation suggest?
- What yield or investment return does the development valuation suggest?

---

## Cross-document / multiple documents

- Compare the Banda Lane and 24 Rudthorpe Road offers
- What documents do we have that mention Banda Lane?
- What documents mention 24 Rudthorpe Road?
- What lease documents do we have and what do they cover?
- What valuation or appraisal documents do we have and what do they value?
- What EPC or energy rating is in the Koch Sales or Highlands Berden reports?
