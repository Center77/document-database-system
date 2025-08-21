// server.js - Complete Cloud-based Document Database System
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import csvParser from 'csv-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ADD THIS TO YOUR server.js FILE - MCP Integration

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Add this to your DocumentDatabaseSystem class constructor
class DocumentDatabaseSystem {
  constructor() {
    this.app = express();
    this.db = null;
    this.databases = ['customers', 'inventory', 'orders', 'employees'];
    
    // Initialize MCP Server
    this.mcpServer = new Server(
      {
        name: 'document-database-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
          prompts: {},
        },
      }
    );
    
    this.setupExpress();
    this.setupDatabase();
    this.setupMCPHandlers();
  }

  // Add this new method to setup MCP handlers
  setupMCPHandlers() {
    // Tool for extracting document data
    this.mcpServer.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'query_database':
          return await this.handleQueryDatabase(args);
        case 'get_all_documents':
          return await this.handleGetAllDocuments(args);
        case 'get_all_forms':
          return await this.handleGetAllForms(args);
        case 'get_form_submissions':
          return await this.handleGetFormSubmissions(args);
        case 'create_form':
          return await this.handleCreateForm(args);
        case 'upload_document':
          return await this.handleUploadDocument(args);
        case 'get_system_stats':
          return await this.handleGetSystemStats(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    // List available tools for Claude
    this.mcpServer.setRequestHandler('tools/list', async () => {
      return {
        tools: [
          {
            name: 'query_database',
            description: 'Query documents and form data by database, date range, or content',
            inputSchema: {
              type: 'object',
              properties: {
                database: { 
                  type: 'string', 
                  description: 'Database name (customers, inventory, orders, employees)',
                  enum: ['customers', 'inventory', 'orders', 'employees']
                },
                query_type: { 
                  type: 'string', 
                  description: 'Type of query',
                  enum: ['documents', 'forms', 'submissions', 'all']
                },
                date_from: { 
                  type: 'string', 
                  description: 'Start date filter (YYYY-MM-DD)' 
                },
                date_to: { 
                  type: 'string', 
                  description: 'End date filter (YYYY-MM-DD)' 
                },
                search_term: { 
                  type: 'string', 
                  description: 'Search in document names or form names' 
                }
              },
              required: ['database']
            }
          },
          {
            name: 'get_all_documents',
            description: 'Get all uploaded documents with their metadata and extracted data',
            inputSchema: {
              type: 'object',
              properties: {
                limit: { 
                  type: 'number', 
                  description: 'Maximum number of documents to return (default: 50)' 
                },
                database: { 
                  type: 'string', 
                  description: 'Filter by specific database' 
                }
              }
            }
          },
          {
            name: 'get_all_forms',
            description: 'Get all created forms with their fields and submission counts',
            inputSchema: {
              type: 'object',
              properties: {
                database: { 
                  type: 'string', 
                  description: 'Filter by specific database' 
                },
                include_fields: { 
                  type: 'boolean', 
                  description: 'Include detailed field information (default: true)' 
                }
              }
            }
          },
          {
            name: 'get_form_submissions',
            description: 'Get all submissions for a specific form or all forms',
            inputSchema: {
              type: 'object',
              properties: {
                form_id: { 
                  type: 'string', 
                  description: 'Specific form ID (optional)' 
                },
                database: { 
                  type: 'string', 
                  description: 'Filter by database' 
                },
                limit: { 
                  type: 'number', 
                  description: 'Maximum submissions to return (default: 100)' 
                }
              }
            }
          },
          {
            name: 'create_form',
            description: 'Create a new form with specified fields',
            inputSchema: {
              type: 'object',
              properties: {
                name: { 
                  type: 'string', 
                  description: 'Form name' 
                },
                database: { 
                  type: 'string', 
                  description: 'Target database',
                  enum: ['customers', 'inventory', 'orders', 'employees']
                },
                fields: {
                  type: 'array',
                  description: 'Form fields configuration',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      label: { type: 'string' },
                      type: { type: 'string' },
                      required: { type: 'boolean' },
                      placeholder: { type: 'string' }
                    },
                    required: ['name', 'label', 'type']
                  }
                }
              },
              required: ['name', 'database', 'fields']
            }
          },
          {
            name: 'get_system_stats',
            description: 'Get comprehensive system statistics and analytics',
            inputSchema: {
              type: 'object',
              properties: {
                include_details: { 
                  type: 'boolean', 
                  description: 'Include detailed breakdown by database (default: true)' 
                }
              }
            }
          }
        ]
      };
    });

    console.log('✅ MCP handlers configured');
  }

  // MCP Handler Methods
  async handleQueryDatabase(args) {
    try {
      const { database, query_type = 'all', date_from, date_to, search_term } = args;
      
      let results = {};
      
      // Build query conditions
      let dateCondition = '';
      let searchCondition = '';
      const params = [];
      
      if (date_from || date_to) {
        if (date_from && date_to) {
          dateCondition = ' AND uploadDate BETWEEN ? AND ?';
          params.push(date_from, date_to + ' 23:59:59');
        } else if (date_from) {
          dateCondition = ' AND uploadDate >= ?';
          params.push(date_from);
        } else if (date_to) {
          dateCondition = ' AND uploadDate <= ?';
          params.push(date_to + ' 23:59:59');
        }
      }
      
      if (search_term) {
        searchCondition = ' AND (customName LIKE ? OR originalName LIKE ?)';
        params.push(`%${search_term}%`, `%${search_term}%`);
      }
      
      // Query documents
      if (query_type === 'documents' || query_type === 'all') {
        const docQuery = `SELECT * FROM documents WHERE database_name = ?${dateCondition}${searchCondition} ORDER BY uploadDate DESC`;
        const documents = await this.queryDatabase(docQuery, [database, ...params]);
        results.documents = documents;
      }
      
      // Query forms
      if (query_type === 'forms' || query_type === 'all') {
        const formQuery = `SELECT * FROM forms WHERE database_name = ? ORDER BY createdDate DESC`;
        const forms = await this.queryDatabase(formQuery, [database]);
        results.forms = forms;
      }
      
      // Query submissions
      if (query_type === 'submissions' || query_type === 'all') {
        const submissionQuery = `
          SELECT fs.*, f.name as form_name 
          FROM form_submissions fs 
          JOIN forms f ON fs.formId = f.id 
          WHERE f.database_name = ? 
          ORDER BY fs.submissionDate DESC
        `;
        const submissions = await this.queryDatabase(submissionQuery, [database]);
        results.submissions = submissions;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              database: database,
              query_type: query_type,
              filters: { date_from, date_to, search_term },
              results: results,
              total_items: Object.values(results).reduce((sum, arr) => sum + (arr?.length || 0), 0)
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error querying database: ${error.message}`
          }
        ]
      };
    }
  }

  async handleGetAllDocuments(args) {
    try {
      const { limit = 50, database } = args;
      
      let query = 'SELECT * FROM documents';
      const params = [];
      
      if (database) {
        query += ' WHERE database_name = ?';
        params.push(database);
      }
      
      query += ' ORDER BY uploadDate DESC LIMIT ?';
      params.push(limit);
      
      const documents = await this.queryDatabase(query, params);
      
      // Parse extracted data for each document
      const enrichedDocuments = documents.map(doc => {
        if (doc.extractedData) {
          try {
            doc.extractedData = JSON.parse(doc.extractedData);
          } catch (e) {
            console.error('Error parsing extracted data:', e);
          }
        }
        return doc;
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              total_documents: enrichedDocuments.length,
              documents: enrichedDocuments
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving documents: ${error.message}`
          }
        ]
      };
    }
  }

  async handleGetAllForms(args) {
    try {
      const { database, include_fields = true } = args;
      
      let query = `
        SELECT f.*, 
               COALESCE(s.submission_count, 0) as submissionCount
        FROM forms f
        LEFT JOIN (
          SELECT formId, COUNT(*) as submission_count 
          FROM form_submissions 
          GROUP BY formId
        ) s ON f.id = s.formId
      `;
      
      const params = [];
      if (database) {
        query += ' WHERE f.database_name = ?';
        params.push(database);
      }
      
      query += ' ORDER BY f.createdDate DESC';
      
      const forms = await this.queryDatabase(query, params);
      
      // Parse fields if requested
      const enrichedForms = forms.map(form => {
        if (include_fields && form.fields) {
          try {
            form.fields = JSON.parse(form.fields);
          } catch (e) {
            console.error('Error parsing form fields:', e);
          }
        }
        return form;
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              total_forms: enrichedForms.length,
              forms: enrichedForms
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving forms: ${error.message}`
          }
        ]
      };
    }
  }

  async handleGetFormSubmissions(args) {
    try {
      const { form_id, database, limit = 100 } = args;
      
      let query = `
        SELECT fs.*, f.name as form_name, f.database_name
        FROM form_submissions fs 
        JOIN forms f ON fs.formId = f.id
      `;
      
      const params = [];
      const conditions = [];
      
      if (form_id) {
        conditions.push('fs.formId = ?');
        params.push(form_id);
      }
      
      if (database) {
        conditions.push('f.database_name = ?');
        params.push(database);
      }
      
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY fs.submissionDate DESC LIMIT ?';
      params.push(limit);
      
      const submissions = await this.queryDatabase(query, params);
      
      // Parse submission data
      const enrichedSubmissions = submissions.map(submission => {
        if (submission.data) {
          try {
            submission.parsedData = JSON.parse(submission.data);
          } catch (e) {
            console.error('Error parsing submission data:', e);
          }
        }
        return submission;
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              total_submissions: enrichedSubmissions.length,
              submissions: enrichedSubmissions
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving submissions: ${error.message}`
          }
        ]
      };
    }
  }

  async handleCreateForm(args) {
    try {
      const { name, database, fields } = args;
      
      const formId = uuidv4();
      const webLink = `${process.env.RENDER_EXTERNAL_URL || 'https://document-database-system.onrender.com'}/form/${formId}`;
      
      const form = {
        id: formId,
        name: name,
        fields: JSON.stringify(fields),
        database_name: database,
        webLink: webLink,
        createdDate: new Date().toISOString(),
        source: 'mcp_claude'
      };
      
      await this.saveForm(form);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              form: {
                id: formId,
                name: name,
                database: database,
                webLink: webLink,
                fieldCount: fields.length,
                fields: fields
              },
              message: `Form '${name}' created successfully for ${database} database`
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating form: ${error.message}`
          }
        ]
      };
    }
  }

  async handleGetSystemStats(args) {
    try {
      const { include_details = true } = args;
      
      // Get overall stats
      const documentCount = await this.queryDatabase('SELECT COUNT(*) as count FROM documents', []);
      const formCount = await this.queryDatabase('SELECT COUNT(*) as count FROM forms', []);
      const submissionCount = await this.queryDatabase('SELECT COUNT(*) as count FROM form_submissions', []);
      
      const stats = {
        overview: {
          total_documents: documentCount[0].count,
          total_forms: formCount[0].count,
          total_submissions: submissionCount[0].count,
          last_updated: new Date().toISOString()
        }
      };
      
      if (include_details) {
        // Get stats by database
        const dbStats = {};
        
        for (const db of this.databases) {
          const docs = await this.queryDatabase('SELECT COUNT(*) as count FROM documents WHERE database_name = ?', [db]);
          const forms = await this.queryDatabase('SELECT COUNT(*) as count FROM forms WHERE database_name = ?', [db]);
          const subs = await this.queryDatabase(`
            SELECT COUNT(*) as count 
            FROM form_submissions fs 
            JOIN forms f ON fs.formId = f.id 
            WHERE f.database_name = ?
          `, [db]);
          
          dbStats[db] = {
            documents: docs[0].count,
            forms: forms[0].count,
            submissions: subs[0].count
          };
        }
        
        stats.by_database = dbStats;
        
        // Get recent activity
        const recentDocs = await this.queryDatabase('SELECT customName, database_name, uploadDate FROM documents ORDER BY uploadDate DESC LIMIT 5', []);
        const recentForms = await this.queryDatabase('SELECT name, database_name, createdDate FROM forms ORDER BY createdDate DESC LIMIT 5', []);
        
        stats.recent_activity = {
          recent_documents: recentDocs,
          recent_forms: recentForms
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(stats, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting system stats: ${error.message}`
          }
        ]
      };
    }
  }

  // Helper method for database queries
  async queryDatabase(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // Update the start method to include MCP server
  async start() {
    // Start Express server
    const PORT = process.env.PORT || 3000;
    this.app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Document Database System running on port ${PORT}`);
      console.log(`📊 Dashboard: http://localhost:${PORT}`);
      console.log(`💾 Database: In-memory SQLite`);
      console.log(`📁 File uploads: ./uploads/`);
      console.log(`✅ System ready for use!`);
    });

    // Start MCP server if in MCP mode
    if (process.env.MCP_MODE === 'true') {
      const transport = new StdioServerTransport();
      await this.mcpServer.connect(transport);
      console.log('🔌 MCP Server connected and ready for Claude Pro');
    }
  }
}


class DocumentDatabaseSystem {
  constructor() {
    this.app = express();
    this.db = null;
    this.databases = ['customers', 'inventory', 'orders', 'employees'];
    this.setupExpress();
    this.setupDatabase();
  }

  setupExpress() {
    // Middleware
    this.app.use(cors());
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));
    this.app.use(express.static('public'));

    // Ensure uploads directory exists
    this.ensureUploadsDirectory();

    // File upload configuration
    const storage = multer.diskStorage({
      destination: async (req, file, cb) => {
        try {
          await fs.mkdir('uploads', { recursive: true });
          cb(null, 'uploads/');
        } catch (error) {
          cb(error, null);
        }
      },
      filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}-${file.originalname}`;
        cb(null, uniqueName);
      }
    });

    this.upload = multer({ 
      storage,
      limits: { 
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 1
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = /\.(pdf|doc|docx|txt|csv)$/i;
        if (allowedTypes.test(file.originalname)) {
          cb(null, true);
        } else {
          cb(new Error('Invalid file type. Only PDF, DOC, DOCX, TXT, and CSV files are allowed.'), false);
        }
      }
    });

    this.setupRoutes();
  }

  async ensureUploadsDirectory() {
    try {
      await fs.mkdir('uploads', { recursive: true });
    } catch (error) {
      console.log('Uploads directory already exists or created');
    }
  }

  setupDatabase() {
    // Initialize main system database
    this.db = new sqlite3.Database(':memory:'); // Use memory database for cloud deployment

    this.db.serialize(() => {
      // Documents table
      this.db.run(`CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        originalName TEXT NOT NULL,
        customName TEXT NOT NULL,
        filePath TEXT NOT NULL,
        database_name TEXT NOT NULL,
        extractedData TEXT,
        uploadDate TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'uploaded',
        fileSize INTEGER,
        fileType TEXT
      )`);

      // Forms table
      this.db.run(`CREATE TABLE IF NOT EXISTS forms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        fields TEXT NOT NULL,
        database_name TEXT NOT NULL,
        webLink TEXT NOT NULL,
        createdDate TEXT NOT NULL,
        source TEXT DEFAULT 'manual',
        submissionCount INTEGER DEFAULT 0
      )`);

      // Form submissions table
      this.db.run(`CREATE TABLE IF NOT EXISTS form_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        formId TEXT NOT NULL,
        data TEXT NOT NULL,
        submissionDate TEXT NOT NULL,
        ipAddress TEXT,
        FOREIGN KEY (formId) REFERENCES forms (id)
      )`);

      // History table
      this.db.run(`CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        action TEXT NOT NULL,
        database_name TEXT,
        timestamp TEXT NOT NULL,
        details TEXT
      )`);

      // CSV data table
      this.db.run(`CREATE TABLE IF NOT EXISTS csv_data (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        headers TEXT NOT NULL,
        data TEXT NOT NULL,
        uploadDate TEXT NOT NULL,
        formGenerated INTEGER DEFAULT 0
      )`);
    });

    console.log('✅ Database initialized successfully');
  }

  setupRoutes() {
    // Serve main application
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // Get available databases
    this.app.get('/api/databases', (req, res) => {
      res.json({ databases: this.databases });
    });

    // Document upload endpoint
    this.app.post('/api/upload-document', this.upload.single('document'), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }

        const { customName, database } = req.body;
        const documentId = uuidv4();

        // Extract data from document
        const extractedData = await this.extractDocumentData(req.file.path, req.file.mimetype);

        // Save document to database
        const document = {
          id: documentId,
          originalName: req.file.originalname,
          customName: customName || req.file.originalname,
          filePath: req.file.path,
          database_name: database,
          extractedData: JSON.stringify(extractedData),
          uploadDate: new Date().toISOString(),
          status: 'processed',
          fileSize: req.file.size,
          fileType: req.file.mimetype
        };

        await this.saveDocument(document);

        res.json({
          success: true,
          document: {
            id: documentId,
            customName: document.customName,
            database: database,
            extractedData: extractedData,
            status: 'processed',
            uploadDate: document.uploadDate
          }
        });

      } catch (error) {
        console.error('Document upload error:', error);
        res.status(500).json({ 
          error: 'Failed to process document',
          details: error.message 
        });
      }
    });

    // CSV upload and processing
    this.app.post('/api/upload-csv', this.upload.single('csv'), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No CSV file uploaded' });
        }

        const csvId = uuidv4();
        const csvData = await this.parseCSV(req.file.path);
        
        // Save CSV data
        const csvRecord = {
          id: csvId,
          filename: req.file.originalname,
          headers: JSON.stringify(csvData.headers),
          data: JSON.stringify(csvData.data),
          uploadDate: new Date().toISOString(),
          formGenerated: 0
        };

        await this.saveCSVData(csvRecord);

        res.json({
          success: true,
          csvId: csvId,
          filename: req.file.originalname,
          headers: csvData.headers,
          rowCount: csvData.data.length,
          canGenerateForm: csvData.headers.length > 0
        });

      } catch (error) {
        console.error('CSV upload error:', error);
        res.status(500).json({ 
          error: 'Failed to process CSV',
          details: error.message 
        });
      }
    });

    // Generate form from CSV
    this.app.post('/api/generate-form-from-csv', async (req, res) => {
      try {
        const { csvId, database } = req.body;

        if (!csvId || !database) {
          return res.status(400).json({ error: 'CSV ID and database are required' });
        }

        const csvRecord = await this.getCSVData(csvId);
        if (!csvRecord) {
          return res.status(404).json({ error: 'CSV record not found' });
        }

        const headers = JSON.parse(csvRecord.headers);
        const form = await this.generateFormFromCSV(headers, database, csvRecord.filename);

        // Mark CSV as having form generated
        await this.updateCSVFormGenerated(csvId);

        res.json({
          success: true,
          form: form
        });

      } catch (error) {
        console.error('Form generation error:', error);
        res.status(500).json({ 
          error: 'Failed to generate form',
          details: error.message 
        });
      }
    });

    // Create custom form
    this.app.post('/api/create-form', async (req, res) => {
      try {
        const { name, fields, database } = req.body;

        if (!name || !fields || !database) {
          return res.status(400).json({ error: 'Name, fields, and database are required' });
        }

        const formId = uuidv4();
        const webLink = `${req.protocol}://${req.get('host')}/form/${formId}`;

        const form = {
          id: formId,
          name: name,
          fields: JSON.stringify(fields),
          database_name: database,
          webLink: webLink,
          createdDate: new Date().toISOString(),
          source: 'manual'
        };

        await this.saveForm(form);

        res.json({
          success: true,
          form: {
            id: formId,
            name: form.name,
            webLink: webLink,
            fields: fields,
            database: database
          }
        });

      } catch (error) {
        console.error('Form creation error:', error);
        res.status(500).json({ 
          error: 'Failed to create form',
          details: error.message 
        });
      }
    });

    // Serve form page
    this.app.get('/form/:formId', async (req, res) => {
      try {
        const { formId } = req.params;
        const form = await this.getForm(formId);

        if (!form) {
          return res.status(404).send('Form not found');
        }

        const fields = JSON.parse(form.fields);
        const formHTML = this.generateFormHTML(form.name, fields, formId);
        res.send(formHTML);

      } catch (error) {
        console.error('Form serving error:', error);
        res.status(500).send('Error loading form');
      }
    });

    // Handle form submission
    this.app.post('/api/form/:formId/submit', async (req, res) => {
      try {
        const { formId } = req.params;
        const formData = req.body;

        const form = await this.getForm(formId);
        if (!form) {
          return res.status(404).json({ error: 'Form not found' });
        }

        // Save form submission
        await this.saveFormSubmission(formId, formData, req.ip);

        res.json({
          success: true,
          message: 'Form submitted successfully'
        });

      } catch (error) {
        console.error('Form submission error:', error);
        res.status(500).json({ 
          error: 'Failed to submit form',
          details: error.message 
        });
      }
    });

    // Get all documents
    this.app.get('/api/documents', async (req, res) => {
      try {
        const documents = await this.getAllDocuments();
        res.json({ success: true, documents });
      } catch (error) {
        console.error('Get documents error:', error);
        res.status(500).json({ error: 'Failed to retrieve documents' });
      }
    });

    // Get all forms
    this.app.get('/api/forms', async (req, res) => {
      try {
        const forms = await this.getAllForms();
        res.json({ success: true, forms });
      } catch (error) {
        console.error('Get forms error:', error);
        res.status(500).json({ error: 'Failed to retrieve forms' });
      }
    });

    // Get all CSV data
    this.app.get('/api/csv-data', async (req, res) => {
      try {
        const csvData = await this.getAllCSVData();
        res.json({ success: true, csvData });
      } catch (error) {
        console.error('Get CSV data error:', error);
        res.status(500).json({ error: 'Failed to retrieve CSV data' });
      }
    });

    // Get history
    this.app.get('/api/history', async (req, res) => {
      try {
        const history = await this.getHistory();
        res.json({ success: true, history });
      } catch (error) {
        console.error('Get history error:', error);
        res.status(500).json({ error: 'Failed to retrieve history' });
      }
    });

    // Error handling middleware
    this.app.use((error, req, res, next) => {
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large (max 50MB)' });
        }
      }
      res.status(500).json({ error: error.message });
    });
  }

  // Database helper methods
  async saveDocument(document) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO documents (id, originalName, customName, filePath, database_name, extractedData, uploadDate, status, fileSize, fileType)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      this.db.run(query, [
        document.id,
        document.originalName,
        document.customName,
        document.filePath,
        document.database_name,
        document.extractedData,
        document.uploadDate,
        document.status,
        document.fileSize,
        document.fileType
      ], function(err) {
        if (err) reject(err);
        else {
          // Add to history
          resolve();
        }
      });
    });
  }

  async saveCSVData(csvRecord) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO csv_data (id, filename, headers, data, uploadDate, formGenerated)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      this.db.run(query, [
        csvRecord.id,
        csvRecord.filename,
        csvRecord.headers,
        csvRecord.data,
        csvRecord.uploadDate,
        csvRecord.formGenerated
      ], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async saveForm(form) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO forms (id, name, fields, database_name, webLink, createdDate, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      
      this.db.run(query, [
        form.id,
        form.name,
        form.fields,
        form.database_name,
        form.webLink,
        form.createdDate,
        form.source
      ], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async saveFormSubmission(formId, formData, ipAddress) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO form_submissions (formId, data, submissionDate, ipAddress)
        VALUES (?, ?, ?, ?)
      `;
      
      this.db.run(query, [
        formId,
        JSON.stringify(formData),
        new Date().toISOString(),
        ipAddress
      ], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getForm(formId) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM forms WHERE id = ?', [formId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async getCSVData(csvId) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM csv_data WHERE id = ?', [csvId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async updateCSVFormGenerated(csvId) {
    return new Promise((resolve, reject) => {
      this.db.run('UPDATE csv_data SET formGenerated = 1 WHERE id = ?', [csvId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getAllDocuments() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM documents ORDER BY uploadDate DESC', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async getAllForms() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM forms ORDER BY createdDate DESC', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async getAllCSVData() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM csv_data ORDER BY uploadDate DESC', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async getHistory() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM history ORDER BY timestamp DESC LIMIT 50', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // Document processing methods
  async extractDocumentData(filePath, mimeType) {
    try {
      const fileExtension = path.extname(filePath).toLowerCase();
      
      switch (fileExtension) {
        case '.txt':
          return await this.processTextFile(filePath);
        case '.csv':
          return await this.parseCSV(filePath);
        default:
          return {
            text: 'File uploaded successfully',
            metadata: {
              fileType: fileExtension,
              processed: true,
              extractedAt: new Date().toISOString()
            }
          };
      }
    } catch (error) {
      console.error('Document extraction error:', error);
      return {
        text: 'Error processing file',
        metadata: {
          error: error.message,
          processed: false
        }
      };
    }
  }

  async processTextFile(filePath) {
    try {
      const text = await fs.readFile(filePath, 'utf8');
      return {
        text: text,
        metadata: {
          fileType: 'text',
          processed: true,
          extractedAt: new Date().toISOString(),
          length: text.length
        }
      };
    } catch (error) {
      throw new Error(`Failed to process text file: ${error.message}`);
    }
  }

  async parseCSV(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      const headers = [];
      let isFirstRow = true;

      createReadStream(filePath)
        .pipe(csvParser())
        .on('headers', (headerList) => {
          headers.push(...headerList);
        })
        .on('data', (data) => {
          results.push(data);
        })
        .on('end', () => {
          resolve({
            headers: headers,
            data: results,
            metadata: {
              fileType: 'csv',
              processed: true,
              extractedAt: new Date().toISOString(),
              rowCount: results.length,
              columnCount: headers.length
            }
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  async generateFormFromCSV(headers, database, filename) {
    const formFields = headers.map(header => ({
      name: header.trim(),
      label: header.trim().replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      type: 'text',
      required: true
    }));

    const formId = uuidv4();
    const webLink = `${process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'}/form/${formId}`;

    const form = {
      id: formId,
      name: `Form generated from ${filename}`,
      fields: JSON.stringify(formFields),
      database_name: database,
      webLink: webLink,
      createdDate: new Date().toISOString(),
      source: 'csv'
    };

    await this.saveForm(form);

    return {
      id: formId,
      name: form.name,
      fields: formFields,
      database: database,
      webLink: webLink,
      createdDate: form.createdDate
    };
  }

  generateFormHTML(formName, fields, formId) {
    const fieldsHTML = fields.map(field => `
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-2">${field.label}:</label>
        <input 
          type="${field.type}" 
          name="${field.name}" 
          ${field.required ? 'required' : ''}
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    `).join('');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${formName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100">
    <div class="min-h-screen flex items-center justify-center">
        <div class="max-w-md w-full bg-white rounded-lg shadow-md p-6">
            <h1 class="text-2xl font-bold text-gray-900 mb-6">${formName}</h1>
            
            <form id="submissionForm">
                ${fieldsHTML}
                
                <button type="submit" class="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors">
                    Submit
                </button>
            </form>
            
            <div id="status" class="mt-4"></div>
        </div>
    </div>

    <script>
        document.getElementById('submissionForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            const statusDiv = document.getElementById('status');
            statusDiv.innerHTML = '<p class="text-blue-600">Submitting...</p>';
            
            try {
                const response = await fetch('/api/form/${formId}/submit', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    statusDiv.innerHTML = '<p class="text-green-600">Form submitted successfully!</p>';
                    e.target.reset();
                } else {
                    statusDiv.innerHTML = '<p class="text-red-600">Error: ' + result.error + '</p>';
                }
            } catch (error) {
                statusDiv.innerHTML = '<p class="text-red-600">Error: ' + error.message + '</p>';
            }
        });
    </script>
</body>
</html>
    `;
  }
// ADD THESE NEW ROUTES TO YOUR server.js FILE

// Get specific form by ID
app.get('/api/forms/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    const form = await this.getForm(formId);
    
    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // Parse fields
    if (form.fields) {
      try {
        form.fields = JSON.parse(form.fields);
      } catch (e) {
        console.error('Error parsing form fields:', e);
      }
    }

    res.json({ success: true, form });
  } catch (error) {
    console.error('Get form error:', error);
    res.status(500).json({ error: 'Failed to retrieve form' });
  }
});

// Update existing form
app.put('/api/forms/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    const { name, fields, database } = req.body;

    if (!name || !fields || !database) {
      return res.status(400).json({ error: 'Name, fields, and database are required' });
    }

    const existingForm = await this.getForm(formId);
    if (!existingForm) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // Update the form
    await this.updateForm(formId, {
      name: name,
      fields: JSON.stringify(fields),
      database_name: database
    });

    res.json({
      success: true,
      message: 'Form updated successfully'
    });

  } catch (error) {
    console.error('Form update error:', error);
    res.status(500).json({ 
      error: 'Failed to update form',
      details: error.message 
    });
  }
});

// Delete form
app.delete('/api/forms/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    
    const form = await this.getForm(formId);
    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // Delete form and all its submissions
    await this.deleteForm(formId);

    res.json({
      success: true,
      message: 'Form deleted successfully'
    });

  } catch (error) {
    console.error('Form deletion error:', error);
    res.status(500).json({ 
      error: 'Failed to delete form',
      details: error.message 
    });
  }
});

// Get form submissions
app.get('/api/forms/:formId/submissions', async (req, res) => {
  try {
    const { formId } = req.params;
    
    const form = await this.getForm(formId);
    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const submissions = await this.getFormSubmissions(formId);

    res.json({
      success: true,
      form: form,
      submissions: submissions
    });

  } catch (error) {
    console.error('Get submissions error:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve submissions',
      details: error.message 
    });
  }
});

// ADD THESE NEW METHODS TO YOUR DocumentDatabaseSystem CLASS

async updateForm(formId, formData) {
  return new Promise((resolve, reject) => {
    const query = `
      UPDATE forms 
      SET name = ?, fields = ?, database_name = ?
      WHERE id = ?
    `;
    
    this.db.run(query, [
      formData.name,
      formData.fields,
      formData.database_name,
      formId
    ], function(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

async deleteForm(formId) {
  return new Promise((resolve, reject) => {
    // First delete all submissions for this form
    this.db.run('DELETE FROM form_submissions WHERE formId = ?', [formId], (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Then delete the form itself
      this.db.run('DELETE FROM forms WHERE id = ?', [formId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

async getFormSubmissions(formId) {
  return new Promise((resolve, reject) => {
    this.db.all(
      'SELECT * FROM form_submissions WHERE formId = ? ORDER BY submissionDate DESC', 
      [formId], 
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

// UPDATE THE EXISTING saveFormSubmission METHOD TO TRACK SUBMISSION COUNT

async saveFormSubmission(formId, formData, ipAddress) {
  return new Promise((resolve, reject) => {
    // Save the submission
    const query = `
      INSERT INTO form_submissions (formId, data, submissionDate, ipAddress)
      VALUES (?, ?, ?, ?)
    `;
    
    this.db.run(query, [
      formId,
      JSON.stringify(formData),
      new Date().toISOString(),
      ipAddress
    ], (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Update submission count in forms table
      this.db.run(
        'UPDATE forms SET submissionCount = submissionCount + 1 WHERE id = ?',
        [formId],
        function(updateErr) {
          if (updateErr) {
            console.error('Error updating submission count:', updateErr);
          }
          resolve();
        }
      );
    });
  });
}

// UPDATE THE FORMS TABLE CREATION TO INCLUDE SUBMISSION COUNT

// In your setupDatabase() method, update the forms table creation:
this.db.run(`CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  fields TEXT NOT NULL,
  database_name TEXT NOT NULL,
  webLink TEXT NOT NULL,
  createdDate TEXT NOT NULL,
  source TEXT DEFAULT 'manual',
  submissionCount INTEGER DEFAULT 0
)`);

// ADD THIS METHOD TO GET ENHANCED FORMS DATA

async getAllForms() {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT f.*, 
             COALESCE(s.submission_count, 0) as submissionCount
      FROM forms f
      LEFT JOIN (
        SELECT formId, COUNT(*) as submission_count 
        FROM form_submissions 
        GROUP BY formId
      ) s ON f.id = s.formId
      ORDER BY f.createdDate DESC
    `;
    
    this.db.all(query, (err, rows) => {
      if (err) reject(err);
      else {
        const forms = (rows || []).map(form => {
          if (form.fields) {
            try {
              form.fields = JSON.parse(form.fields);
            } catch (e) {
              console.error('Error parsing form fields:', e);
            }
          }
          return form;
        });
        resolve(forms);
      }
    });
  });
}
  start() {
    const PORT = process.env.PORT || 3000;
    this.app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Document Database System running on port ${PORT}`);
      console.log(`📊 Dashboard: http://localhost:${PORT}`);
      console.log(`💾 Database: In-memory SQLite`);
      console.log(`📁 File uploads: ./uploads/`);
      console.log(`✅ System ready for use!`);
    });
  }
}

// Start the server
const system = new DocumentDatabaseSystem();
system.start();
