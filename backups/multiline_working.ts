import Jimp from 'jimp';
import Airtable from 'airtable';
import fs from 'fs';
import axios from 'axios';
import PDFDocument from 'pdfkit';

// Airtable configuration
const API_KEY = process.env['AIRTABLE_API_KEY'];
const BASE_ID = process.env['AIRTABLE_BASE_ID'];
const TABLE_NAME = process.env['AIRTABLE_TABLE_NAME'];

// Airtable base
const base = new Airtable({ apiKey: API_KEY }).base(BASE_ID);

// Sanitize file names
function sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
}

// Fetch records matching the criteria
async function fetchRecords() {
    try {
        const records: any[] = [];
        console.log("Fetching records...");

        await base(TABLE_NAME)
            .select({
                filterByFormula: `
                    AND(
                        {PDF Status} = 'Generate PDF',
                        {Participant Full Name} != '',
                        {Achievement level} != '',
                        {PDF Attachment} = ''
                    )
                `,
            })
            .eachPage((pageRecords, fetchNextPage) => {
                records.push(...pageRecords);
                fetchNextPage();
            });

        console.log(`Fetched ${records.length} records.`);
        return records;
    } catch (error) {
        console.error("Error fetching records:", error);
        throw error;
    }
}

async function processRecord(record: any) {
    try {
        const fields = record.fields;

        // Extract data from record
        let participantName = fields["Participant Full Name"].toUpperCase(); // Convert to uppercase
        const achievementLevel = fields["Achievement level"];
        const programmeName = Array.isArray(fields["Programme name (from 📺 Programmes)"])
            ? fields["Programme name (from 📺 Programmes)"][0]
            : fields["Programme name (from 📺 Programmes)"];
        const certificateImageURL = fields["Certificate image (from 📺 Programmes)"][0].url;

        console.log(`Processing: ${participantName}, ${achievementLevel}, ${programmeName}`);

        // Download certificate image
        const response = await axios.get(certificateImageURL, { responseType: 'arraybuffer' });
        const background = await Jimp.read(Buffer.from(response.data));

        // Load fonts
        const fontBold = await Jimp.loadFont('./fonts/Montserrat-SemiBold.fnt'); // Bold font
        const fontRegular = await Jimp.loadFont('./fonts/Montserrat-Regular.fnt'); // Regular font

        // Image dimensions
        const { width, height } = background.bitmap;
        const margin = 80;

        // Calculate wrapped participant name
        const wrappedParticipantName = wrapText(participantName, fontRegular, width * 0.8); // Wrap near edges
        const numberOfLines = wrappedParticipantName.split('\n').length;

        // Adjust Y position based on number of lines
        const participantNameY = numberOfLines > 1 ? height * 0.45 : height * 0.52; // Lower if wrapped, higher if single-line

        // Add text: Participant Name
        const participantNameX = margin;
        background.print(
            fontRegular, // Regular font for participant name
            participantNameX,
            participantNameY,
            { text: wrappedParticipantName, alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT },
            width - margin * 2
        );

        // Add text: Achievement Level (Regular Font)
        const achievementLevelX = margin;
        const achievementLevelY = height * 0.65;
        background.print(
            fontRegular, // Use regular font
            achievementLevelX,
            achievementLevelY,
            { text: achievementLevel.toUpperCase(), alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT },
            width - margin * 2
        );

        // Add text: Programme Name (Bold Font, Wrapped)
        const programmeNameX = margin;
        const programmeNameY = height * 0.8; // Lowered position
        const wrappedProgrammeName = wrapText(programmeName.toUpperCase(), fontBold, width * 0.4); // Wrap more tightly
        background.print(
            fontBold, // Bold font for programme name
            programmeNameX,
            programmeNameY,
            { text: wrappedProgrammeName, alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT },
            width - margin * 2
        );

        // Save the image
        const sanitizedParticipantName = sanitizeFileName(participantName);
        const sanitizedProgrammeName = sanitizeFileName(programmeName);
        const imagePath = `./${sanitizedParticipantName}-${sanitizedProgrammeName}.png`;
        await background.writeAsync(imagePath);
        console.log(`Saved image: ${imagePath}`);

        // Convert the image to a PDF
        const pdfPath = `./${sanitizedParticipantName}-${sanitizedProgrammeName}.pdf`;
        const doc = new PDFDocument({
            layout: 'landscape',
            size: [width, height],
        });
        const writeStream = fs.createWriteStream(pdfPath);
        doc.pipe(writeStream);
        doc.image(imagePath, 0, 0, { width: width, height: height });
        doc.end();

        // Wait for PDF to finish writing
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });

        console.log(`Generated PDF: ${pdfPath}`);

    } catch (error) {
        console.error(`Error processing record ${record.id}:`, error);
    }
}

// Helper function for text wrapping
function wrapText(text: string, font: any, maxWidth: number): string {
    const words = text.split(' ');
    let currentLine = '';
    let result = '';

    for (const word of words) {
        const testLine = `${currentLine} ${word}`.trim();
        const textWidth = Jimp.measureText(font, testLine);
        if (textWidth <= maxWidth) {
            currentLine = testLine;
        } else {
            result += `${currentLine}\n`;
            currentLine = word;
        }
    }

    if (currentLine) result += currentLine;
    return result.trim();
}

// Main function
async function main() {
    try {
        const records = await fetchRecords();
        for (const record of records) {
            try {
                await processRecord(record);
            } catch (error) {
                console.error(`Error processing record ${record.id}:`, error);
            }
        }
    } catch (error) {
        console.error("Error in main execution:", error);
    }
}

main();
