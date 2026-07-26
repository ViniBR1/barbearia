const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const mercadopago = require('mercadopago');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// ========== CONFIGURAÇÕES ==========
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ========== NEON POSTGRESQL ==========
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// ========== MERCADO PAGO ==========
mercadopago.configure({
    access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN
});

// ========== INICIALIZAR BANCO ==========
async function initDatabase() {
    try {
        console.log('🔄 Inicializando banco de dados...');

        const tabelas = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        
        const tabelasExistentes = tabelas.rows.map(t => t.table_name);
        console.log('📋 Tabelas existentes:', tabelasExistentes);

        if (tabelasExistentes.length === 0) {
            console.log('🔧 Criando todas as tabelas...');
            
            await pool.query(`
                CREATE TABLE barbearias (
                    id SERIAL PRIMARY KEY,
                    nome VARCHAR(100) NOT NULL,
                    slug VARCHAR(100) UNIQUE NOT NULL,
                    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await pool.query(`
                CREATE TABLE clientes (
                    id SERIAL PRIMARY KEY,
                    nome VARCHAR(100) NOT NULL,
                    email VARCHAR(100) UNIQUE NOT NULL,
                    senha VARCHAR(255) NOT NULL,
                    telefone VARCHAR(20),
                    cpf VARCHAR(14),
                    assinatura VARCHAR(50) DEFAULT 'nenhum',
                    cortes_gratis INTEGER DEFAULT 0,
                    pontos INTEGER DEFAULT 0,
                    total_cortes INTEGER DEFAULT 0,
                    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    ultimo_login TIMESTAMP
                )
            `);

            await pool.query(`
                CREATE TABLE planos (
                    id SERIAL PRIMARY KEY,
                    barbearia_id INTEGER REFERENCES barbearias(id) ON DELETE CASCADE,
                    nome VARCHAR(50) NOT NULL,
                    descricao TEXT,
                    preco DECIMAL(10,2) NOT NULL,
                    cortes_por_mes INTEGER NOT NULL,
                    prioridade BOOLEAN DEFAULT FALSE,
                    ativo BOOLEAN DEFAULT TRUE,
                    UNIQUE(barbearia_id, nome)
                )
            `);

            await pool.query(`
                CREATE TABLE servicos_avulsos (
                    id SERIAL PRIMARY KEY,
                    barbearia_id INTEGER REFERENCES barbearias(id) ON DELETE CASCADE,
                    nome VARCHAR(50) NOT NULL,
                    descricao TEXT,
                    preco DECIMAL(10,2) NOT NULL,
                    duracao INTEGER DEFAULT 30,
                    ativo BOOLEAN DEFAULT TRUE,
                    UNIQUE(barbearia_id, nome)
                )
            `);

            await pool.query(`
                CREATE TABLE agendamentos (
                    id SERIAL PRIMARY KEY,
                    barbearia_id INTEGER REFERENCES barbearias(id) ON DELETE CASCADE,
                    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
                    cliente_nome VARCHAR(100) NOT NULL,
                    cliente_cpf VARCHAR(14),
                    cliente_telefone VARCHAR(20),
                    servico VARCHAR(50) NOT NULL,
                    plano_id INTEGER REFERENCES planos(id) ON DELETE SET NULL,
                    data_hora TIMESTAMP NOT NULL,
                    observacao TEXT,
                    status VARCHAR(20) DEFAULT 'aguardando',
                    prioridade BOOLEAN DEFAULT FALSE,
                    pagamento_id VARCHAR(100),
                    valor_pago DECIMAL(10,2),
                    forma_pagamento VARCHAR(20) DEFAULT 'cartao',
                    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    finalizado_em TIMESTAMP
                )
            `);

            await pool.query(`
                CREATE TABLE pagamentos (
                    id SERIAL PRIMARY KEY,
                    cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
                    agendamento_id INTEGER REFERENCES agendamentos(id) ON DELETE SET NULL,
                    mp_preference_id VARCHAR(100) UNIQUE,
                    mp_payment_id VARCHAR(100),
                    valor DECIMAL(10,2) NOT NULL,
                    status VARCHAR(50) DEFAULT 'pendente',
                    metodo VARCHAR(50),
                    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await pool.query(`
                CREATE TABLE precos (
                    id SERIAL PRIMARY KEY,
                    barbearia_id INTEGER REFERENCES barbearias(id) ON DELETE CASCADE,
                    servico VARCHAR(50) NOT NULL,
                    preco DECIMAL(10,2) NOT NULL,
                    UNIQUE(barbearia_id, servico)
                )
            `);

            await pool.query(`
                CREATE TABLE estoque (
                    id SERIAL PRIMARY KEY,
                    barbearia_id INTEGER REFERENCES barbearias(id) ON DELETE CASCADE,
                    item VARCHAR(100) NOT NULL,
                    quantidade INTEGER DEFAULT 0,
                    UNIQUE(barbearia_id, item)
                )
            `);

            console.log('✅ Todas as tabelas criadas!');

            await pool.query(
                `INSERT INTO barbearias (nome, slug) VALUES ($1, $2)`,
                ['BarbeOnline', 'barbeonline']
            );
            console.log('✅ Barbearia padrão criada!');

            const planos = [
                { nome: 'Avulso', descricao: 'Corte único sem compromisso', preco: 45.00, cortes_por_mes: 1, prioridade: false },
                { nome: 'Mensal', descricao: '1 corte por semana com prioridade', preco: 89.90, cortes_por_mes: 4, prioridade: true },
                { nome: 'Familiar', descricao: 'Até 4 pessoas, cortes ilimitados', preco: 159.90, cortes_por_mes: 12, prioridade: true },
                { nome: 'Premium', descricao: 'Cortes ilimitados + prioridade máxima', preco: 199.90, cortes_por_mes: 0, prioridade: true }
            ];

            for (const plano of planos) {
                await pool.query(
                    `INSERT INTO planos (barbearia_id, nome, descricao, preco, cortes_por_mes, prioridade) 
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [1, plano.nome, plano.descricao, plano.preco, plano.cortes_por_mes, plano.prioridade]
                );
            }
            console.log('✅ Planos padrão criados!');

            const servicos = [
                { nome: 'Corte de Cabelo', descricao: 'Corte completo com tesoura e máquina', preco: 45.00, duracao: 30 },
                { nome: 'Barba', descricao: 'Barba completa com navalha', preco: 35.00, duracao: 25 },
                { nome: 'Corte + Barba', descricao: 'Pacote completo de beleza', preco: 70.00, duracao: 50 },
                { nome: 'Sobrancelha', descricao: 'Design de sobrancelhas', preco: 20.00, duracao: 15 },
                { nome: 'Hidratação', descricao: 'Hidratação capilar profunda', preco: 30.00, duracao: 20 }
            ];

            for (const servico of servicos) {
                await pool.query(
                    `INSERT INTO servicos_avulsos (barbearia_id, nome, descricao, preco, duracao) 
                     VALUES ($1, $2, $3, $4, $5)`,
                    [1, servico.nome, servico.descricao, servico.preco, servico.duracao]
                );
            }
            console.log('✅ Serviços padrão criados!');
        } else {
            console.log('✅ Banco já possui tabelas, verificando estrutura...');
            
            // Verificar colunas da tabela clientes
            const colunasClientes = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'clientes'
            `);
            const colunasExistentes = colunasClientes.rows.map(c => c.column_name);
            console.log('📋 Colunas em clientes:', colunasExistentes);

            if (!colunasExistentes.includes('senha')) {
                await pool.query(`ALTER TABLE clientes ADD COLUMN senha VARCHAR(255) NOT NULL DEFAULT ''`);
                console.log('✅ Coluna senha adicionada!');
            }
            if (!colunasExistentes.includes('cpf')) {
                await pool.query(`ALTER TABLE clientes ADD COLUMN cpf VARCHAR(14)`);
                console.log('✅ Coluna cpf adicionada!');
            }
            if (!colunasExistentes.includes('telefone')) {
                await pool.query(`ALTER TABLE clientes ADD COLUMN telefone VARCHAR(20)`);
                console.log('✅ Coluna telefone adicionada!');
            }
            if (!colunasExistentes.includes('assinatura')) {
                await pool.query(`ALTER TABLE clientes ADD COLUMN assinatura VARCHAR(50) DEFAULT 'nenhum'`);
                console.log('✅ Coluna assinatura adicionada!');
            }
            if (!colunasExistentes.includes('cortes_gratis')) {
                await pool.query(`ALTER TABLE clientes ADD COLUMN cortes_gratis INTEGER DEFAULT 0`);
                console.log('✅ Coluna cortes_gratis adicionada!');
            }
            if (!colunasExistentes.includes('pontos')) {
                await pool.query(`ALTER TABLE clientes ADD COLUMN pontos INTEGER DEFAULT 0`);
                console.log('✅ Coluna pontos adicionada!');
            }
            if (!colunasExistentes.includes('total_cortes')) {
                await pool.query(`ALTER TABLE clientes ADD COLUMN total_cortes INTEGER DEFAULT 0`);
                console.log('✅ Coluna total_cortes adicionada!');
            }

            // Verificar colunas da tabela agendamentos
            const colunasAgendamentos = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'agendamentos'
            `);
            const colunasAgend = colunasAgendamentos.rows.map(c => c.column_name);

            if (!colunasAgend.includes('cliente_cpf')) {
                await pool.query(`ALTER TABLE agendamentos ADD COLUMN cliente_cpf VARCHAR(14)`);
                console.log('✅ Coluna cliente_cpf adicionada!');
            }
            if (!colunasAgend.includes('cliente_telefone')) {
                await pool.query(`ALTER TABLE agendamentos ADD COLUMN cliente_telefone VARCHAR(20)`);
                console.log('✅ Coluna cliente_telefone adicionada!');
            }
            if (!colunasAgend.includes('forma_pagamento')) {
                await pool.query(`ALTER TABLE agendamentos ADD COLUMN forma_pagamento VARCHAR(20) DEFAULT 'cartao'`);
                console.log('✅ Coluna forma_pagamento adicionada!');
            }
            if (!colunasAgend.includes('finalizado_em')) {
                await pool.query(`ALTER TABLE agendamentos ADD COLUMN finalizado_em TIMESTAMP`);
                console.log('✅ Coluna finalizado_em adicionada!');
            }

            // Verificar barbearia padrão
            const barbeariaCheck = await pool.query(`SELECT * FROM barbearias WHERE slug = 'barbeonline'`);
            if (barbeariaCheck.rows.length === 0) {
                await pool.query(`INSERT INTO barbearias (nome, slug) VALUES ('BarbeOnline', 'barbeonline')`);
                console.log('✅ Barbearia padrão criada!');
            }
        }

        console.log('✅ Banco de dados pronto!');
        return 1;
        
    } catch (error) {
        console.error('❌ Erro ao inicializar banco:', error);
        throw error;
    }
}

// ========== ROTAS DE AUTENTICAÇÃO ==========

app.post('/api/clientes/registrar', async (req, res) => {
    const { nome, email, senha, telefone, cpf } = req.body;

    if (!nome || !email || !senha) {
        return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }

    try {
        const existe = await pool.query('SELECT id FROM clientes WHERE email = $1', [email]);
        if (existe.rows.length > 0) {
            return res.status(400).json({ error: 'Email já cadastrado' });
        }

        if (cpf) {
            const existeCpf = await pool.query('SELECT id FROM clientes WHERE cpf = $1', [cpf]);
            if (existeCpf.rows.length > 0) {
                return res.status(400).json({ error: 'CPF já cadastrado' });
            }
        }

        const senhaHash = Buffer.from(senha).toString('base64');

        const result = await pool.query(
            `INSERT INTO clientes (nome, email, senha, telefone, cpf) 
             VALUES ($1, $2, $3, $4, $5) 
             RETURNING id, nome, email, telefone, cpf, assinatura, cortes_gratis, pontos, total_cortes, criado_em`,
            [nome, email, senhaHash, telefone || null, cpf || null]
        );

        res.json({
            success: true,
            cliente: result.rows[0],
            message: 'Cliente registrado com sucesso!'
        });
    } catch (error) {
        console.error('❌ Erro ao registrar cliente:', error);
        res.status(500).json({ error: 'Erro ao registrar cliente: ' + error.message });
    }
});

app.post('/api/clientes/login', async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    try {
        const senhaHash = Buffer.from(senha).toString('base64');

        const result = await pool.query(
            `SELECT id, nome, email, telefone, cpf, assinatura, cortes_gratis, pontos, total_cortes, criado_em 
             FROM clientes 
             WHERE email = $1 AND senha = $2`,
            [email, senhaHash]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Email ou senha incorretos' });
        }

        await pool.query(
            'UPDATE clientes SET ultimo_login = CURRENT_TIMESTAMP WHERE id = $1',
            [result.rows[0].id]
        );

        res.json({
            success: true,
            cliente: result.rows[0],
            message: 'Login realizado com sucesso!'
        });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ error: 'Erro ao fazer login' });
    }
});

app.get('/api/clientes/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `SELECT id, nome, email, telefone, cpf, assinatura, cortes_gratis, pontos, total_cortes, criado_em, ultimo_login 
             FROM clientes 
             WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Cliente não encontrado' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao buscar cliente:', error);
        res.status(500).json({ error: 'Erro ao buscar cliente' });
    }
});

app.put('/api/clientes/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, telefone, cpf, assinatura } = req.body;

    try {
        const result = await pool.query(
            `UPDATE clientes 
             SET nome = COALESCE($1, nome), 
                 telefone = COALESCE($2, telefone),
                 cpf = COALESCE($3, cpf),
                 assinatura = COALESCE($4, assinatura)
             WHERE id = $5
             RETURNING id, nome, email, telefone, cpf, assinatura, cortes_gratis, pontos, total_cortes`,
            [nome, telefone, cpf, assinatura, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Cliente não encontrado' });
        }

        res.json({
            success: true,
            cliente: result.rows[0],
            message: 'Cliente atualizado com sucesso!'
        });
    } catch (error) {
        console.error('Erro ao atualizar cliente:', error);
        res.status(500).json({ error: 'Erro ao atualizar cliente' });
    }
});

app.get('/api/clientes', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, nome, email, telefone, cpf, assinatura, cortes_gratis, pontos, total_cortes, criado_em FROM clientes ORDER BY id'
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/clientes/cpf/:cpf', async (req, res) => {
    const { cpf } = req.params;
    try {
        const result = await pool.query(
            'SELECT id, nome, email, telefone, cpf, assinatura, cortes_gratis, pontos, total_cortes FROM clientes WHERE cpf = $1',
            [cpf]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Cliente não encontrado' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== ROTAS DE ADMIN ==========

app.post('/api/admin/login', async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    try {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@barbearia.com';
        const adminSenha = process.env.ADMIN_PASSWORD || 'admin123';

        if (email === adminEmail && senha === adminSenha) {
            const token = Buffer.from(`${email}:${Date.now()}`).toString('base64');
            
            res.json({
                success: true,
                token: token,
                admin: {
                    nome: 'Administrador',
                    email: adminEmail
                },
                message: 'Login realizado com sucesso!'
            });
        } else {
            res.status(401).json({ error: 'Email ou senha incorretos' });
        }
    } catch (error) {
        console.error('Erro no login admin:', error);
        res.status(500).json({ error: 'Erro ao fazer login' });
    }
});

app.get('/api/admin/verificar', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }

    try {
        const decoded = Buffer.from(token, 'base64').toString();
        const [email] = decoded.split(':');
        
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@barbearia.com';
        
        if (email === adminEmail) {
            res.json({
                success: true,
                admin: {
                    nome: 'Administrador',
                    email: adminEmail
                }
            });
        } else {
            res.status(401).json({ error: 'Token inválido' });
        }
    } catch (error) {
        res.status(401).json({ error: 'Token inválido' });
    }
});

// ========== ROTAS DE BARBEARIAS ==========

app.get('/api/barbearias', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM barbearias ORDER BY id');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/barbearias', async (req, res) => {
    const { nome, slug } = req.body;

    if (!nome || !slug) {
        return res.status(400).json({ error: 'Nome e slug são obrigatórios' });
    }

    try {
        const existe = await pool.query('SELECT id FROM barbearias WHERE slug = $1', [slug]);
        if (existe.rows.length > 0) {
            return res.status(400).json({ error: 'Slug já está em uso' });
        }

        const result = await pool.query(
            'INSERT INTO barbearias (nome, slug) VALUES ($1, $2) RETURNING *',
            [nome, slug]
        );

        const barbeariaId = result.rows[0].id;
        
        const planos = [
            { nome: 'Avulso', descricao: 'Corte único sem compromisso', preco: 45.00, cortes_por_mes: 1, prioridade: false },
            { nome: 'Mensal', descricao: '1 corte por semana com prioridade', preco: 89.90, cortes_por_mes: 4, prioridade: true },
            { nome: 'Familiar', descricao: 'Até 4 pessoas, cortes ilimitados', preco: 159.90, cortes_por_mes: 12, prioridade: true },
            { nome: 'Premium', descricao: 'Cortes ilimitados + prioridade máxima', preco: 199.90, cortes_por_mes: 0, prioridade: true }
        ];

        for (const plano of planos) {
            await pool.query(
                `INSERT INTO planos (barbearia_id, nome, descricao, preco, cortes_por_mes, prioridade) 
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [barbeariaId, plano.nome, plano.descricao, plano.preco, plano.cortes_por_mes, plano.prioridade]
            );
        }

        const servicos = [
            { nome: 'Corte de Cabelo', descricao: 'Corte completo com tesoura e máquina', preco: 45.00, duracao: 30 },
            { nome: 'Barba', descricao: 'Barba completa com navalha', preco: 35.00, duracao: 25 },
            { nome: 'Corte + Barba', descricao: 'Pacote completo de beleza', preco: 70.00, duracao: 50 }
        ];

        for (const servico of servicos) {
            await pool.query(
                `INSERT INTO servicos_avulsos (barbearia_id, nome, descricao, preco, duracao) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [barbeariaId, servico.nome, servico.descricao, servico.preco, servico.duracao]
            );
        }

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== ROTAS DE SERVIÇOS ==========

app.get('/api/servicos/:barbeariaId', async (req, res) => {
    const { barbeariaId } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM servicos_avulsos WHERE barbearia_id = $1 ORDER BY id',
            [barbeariaId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Erro ao listar serviços:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/servicos', async (req, res) => {
    const { barbeariaId, nome, descricao, preco, duracao } = req.body;

    if (!barbeariaId || !nome || !preco) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    try {
        const existe = await pool.query(
            'SELECT id FROM servicos_avulsos WHERE barbearia_id = $1 AND nome = $2',
            [barbeariaId, nome]
        );

        let result;
        if (existe.rows.length > 0) {
            result = await pool.query(
                `UPDATE servicos_avulsos 
                 SET descricao = $1, preco = $2, duracao = $3, ativo = true
                 WHERE barbearia_id = $4 AND nome = $5
                 RETURNING *`,
                [descricao || '', preco, duracao || 30, barbeariaId, nome]
            );
        } else {
            result = await pool.query(
                `INSERT INTO servicos_avulsos (barbearia_id, nome, descricao, preco, duracao) 
                 VALUES ($1, $2, $3, $4, $5) 
                 RETURNING *`,
                [barbeariaId, nome, descricao || '', preco, duracao || 30]
            );
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('❌ Erro ao salvar serviço:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/servicos/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            'DELETE FROM servicos_avulsos WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Serviço não encontrado' });
        }

        res.json({ success: true, message: 'Serviço removido com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao deletar serviço:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== ROTAS DE PLANOS ==========

app.get('/api/planos/:barbeariaId', async (req, res) => {
    const { barbeariaId } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM planos WHERE barbearia_id = $1 ORDER BY preco',
            [barbeariaId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/planos', async (req, res) => {
    const { barbeariaId, nome, descricao, preco, cortes_por_mes, prioridade } = req.body;

    if (!barbeariaId || !nome || !preco) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    try {
        const existe = await pool.query(
            'SELECT id FROM planos WHERE barbearia_id = $1 AND nome = $2',
            [barbeariaId, nome]
        );

        let result;
        if (existe.rows.length > 0) {
            result = await pool.query(
                `UPDATE planos 
                 SET descricao = $1, preco = $2, cortes_por_mes = $3, prioridade = $4, ativo = true
                 WHERE barbearia_id = $5 AND nome = $6
                 RETURNING *`,
                [descricao || '', preco, cortes_por_mes || 1, prioridade || false, barbeariaId, nome]
            );
        } else {
            result = await pool.query(
                `INSERT INTO planos (barbearia_id, nome, descricao, preco, cortes_por_mes, prioridade) 
                 VALUES ($1, $2, $3, $4, $5, $6) 
                 RETURNING *`,
                [barbeariaId, nome, descricao || '', preco, cortes_por_mes || 1, prioridade || false]
            );
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('❌ Erro ao salvar plano:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== ROTAS DE AGENDAMENTOS ==========

app.get('/api/agendamentos/:barbeariaId', async (req, res) => {
    const { barbeariaId } = req.params;

    try {
        const result = await pool.query(
            `SELECT a.*, c.nome as cliente_nome_completo, c.cpf, c.telefone 
             FROM agendamentos a
             LEFT JOIN clientes c ON a.cliente_id = c.id
             WHERE a.barbearia_id = $1 
             ORDER BY a.data_hora DESC`,
            [barbeariaId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/agendamentos/cliente/:clienteId', async (req, res) => {
    const { clienteId } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM agendamentos WHERE cliente_id = $1 ORDER BY data_hora DESC',
            [clienteId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/agendamentos/proximos/:barbeariaId', async (req, res) => {
    const { barbeariaId } = req.params;

    try {
        const result = await pool.query(
            `SELECT a.*, c.nome as cliente_nome_completo 
             FROM agendamentos a
             LEFT JOIN clientes c ON a.cliente_id = c.id
             WHERE a.barbearia_id = $1 AND a.status IN ('aguardando', 'confirmado')
             ORDER BY a.prioridade DESC, a.data_hora ASC
             LIMIT 5`,
            [barbeariaId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/agendamentos/fila/:barbeariaId', async (req, res) => {
    const { barbeariaId } = req.params;

    try {
        const result = await pool.query(
            `SELECT a.*, c.nome as cliente_nome_completo,
                    EXTRACT(EPOCH FROM (NOW() - a.criado_em)) as tempo_espera
             FROM agendamentos a
             LEFT JOIN clientes c ON a.cliente_id = c.id
             WHERE a.barbearia_id = $1 AND a.status IN ('aguardando', 'confirmado')
             ORDER BY a.prioridade DESC, a.data_hora ASC`,
            [barbeariaId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/agendamentos', async (req, res) => {
    const { 
        clienteId, 
        clienteNome, 
        clienteCpf,
        clienteTelefone,
        servico, 
        planoId, 
        data_hora, 
        observacao, 
        prioridade,
        forma_pagamento,
        valor
    } = req.body;

    console.log('📝 Dados recebidos:', req.body);

    if (!clienteNome) {
        return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
    }
    if (!servico) {
        return res.status(400).json({ error: 'Serviço é obrigatório' });
    }
    if (!data_hora) {
        return res.status(400).json({ error: 'Data e hora são obrigatórias' });
    }

    try {
        const barbeariaIdInt = 1;

        let clienteIdInt = null;
        if (clienteId && clienteId !== 'null' && clienteId !== 'undefined' && clienteId !== '') {
            clienteIdInt = parseInt(clienteId);
            if (isNaN(clienteIdInt) || clienteIdInt <= 0) {
                clienteIdInt = null;
            }
        }

        // Se tem CPF, busca cliente
        if (clienteCpf && !clienteIdInt) {
            const clienteExistente = await pool.query(
                'SELECT id FROM clientes WHERE cpf = $1',
                [clienteCpf]
            );
            if (clienteExistente.rows.length > 0) {
                clienteIdInt = clienteExistente.rows[0].id;
            }
        }

        let planoIdInt = null;
        if (planoId && planoId !== 'null' && planoId !== 'undefined' && planoId !== '') {
            planoIdInt = parseInt(planoId);
            if (isNaN(planoIdInt) || planoIdInt <= 0) {
                planoIdInt = null;
            }
        }

        let valorFinal = valor || 0;
        if (valorFinal === 0) {
            const servicoDb = await pool.query(
                'SELECT preco FROM servicos_avulsos WHERE nome = $1 AND barbearia_id = $2',
                [servico, barbeariaIdInt]
            );
            if (servicoDb.rows.length > 0) {
                valorFinal = servicoDb.rows[0].preco;
            } else {
                valorFinal = 45.00;
            }
        }

        const result = await pool.query(
            `INSERT INTO agendamentos 
             (barbearia_id, cliente_id, cliente_nome, cliente_cpf, cliente_telefone, servico, plano_id, data_hora, observacao, prioridade, valor_pago, forma_pagamento) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
             RETURNING *`,
            [
                barbeariaIdInt, 
                clienteIdInt, 
                clienteNome, 
                clienteCpf || null,
                clienteTelefone || null,
                servico, 
                planoIdInt, 
                data_hora, 
                observacao || null, 
                prioridade || false, 
                valorFinal,
                forma_pagamento || 'cartao'
            ]
        );

        // Se não tem cliente, criar um novo
        if (!clienteIdInt && clienteTelefone) {
            const novoCliente = await pool.query(
                `INSERT INTO clientes (nome, telefone, cpf, email, senha) 
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id`,
                [clienteNome, clienteTelefone, clienteCpf || null, `${clienteTelefone}@cliente.com`, Buffer.from('123456').toString('base64')]
            );
            if (novoCliente.rows.length > 0) {
                await pool.query(
                    'UPDATE agendamentos SET cliente_id = $1 WHERE id = $2',
                    [novoCliente.rows[0].id, result.rows[0].id]
                );
                clienteIdInt = novoCliente.rows[0].id;
            }
        }

        // Atualizar pontos e contagem de cortes
        if (clienteIdInt) {
            await pool.query(
                'UPDATE clientes SET pontos = pontos + 1, total_cortes = total_cortes + 1 WHERE id = $1',
                [clienteIdInt]
            );

            const cliente = await pool.query(
                'SELECT pontos, total_cortes FROM clientes WHERE id = $1',
                [clienteIdInt]
            );
            
            // A cada 4 cortes, ganha 1 grátis
            if (cliente.rows[0] && cliente.rows[0].pontos % 4 === 0) {
                await pool.query(
                    'UPDATE clientes SET cortes_gratis = cortes_gratis + 1 WHERE id = $1',
                    [clienteIdInt]
                );
                console.log('🎉 Cliente ganhou corte grátis!');
            }
        }

        res.json({
            ...result.rows[0],
            valor_pago: valorFinal,
            message: 'Agendamento criado com sucesso!'
        });

    } catch (error) {
        console.error('❌ Erro ao criar agendamento:', error);
        res.status(500).json({ 
            error: 'Erro ao criar agendamento: ' + error.message 
        });
    }
});

app.put('/api/agendamentos/:id', async (req, res) => {
    const { id } = req.params;
    const { status, pagamento_id, forma_pagamento } = req.body;

    try {
        let query = 'UPDATE agendamentos SET status = $1';
        let params = [status];
        let paramCount = 2;

        if (pagamento_id) {
            query += `, pagamento_id = $${paramCount}`;
            params.push(pagamento_id);
            paramCount++;
        }

        if (forma_pagamento) {
            query += `, forma_pagamento = $${paramCount}`;
            params.push(forma_pagamento);
            paramCount++;
        }

        if (status === 'done') {
            query += `, finalizado_em = NOW()`;
            
            // Buscar o cliente_id do agendamento
            const agendamento = await pool.query(
                'SELECT cliente_id FROM agendamentos WHERE id = $1',
                [id]
            );
            
            if (agendamento.rows[0] && agendamento.rows[0].cliente_id) {
                const clienteId = agendamento.rows[0].cliente_id;
                // Atualizar pontos e total de cortes
                await pool.query(
                    'UPDATE clientes SET pontos = pontos + 1, total_cortes = total_cortes + 1 WHERE id = $1',
                    [clienteId]
                );
                
                const cliente = await pool.query(
                    'SELECT pontos FROM clientes WHERE id = $1',
                    [clienteId]
                );
                
                if (cliente.rows[0] && cliente.rows[0].pontos % 4 === 0) {
                    await pool.query(
                        'UPDATE clientes SET cortes_gratis = cortes_gratis + 1 WHERE id = $1',
                        [clienteId]
                    );
                    console.log('🎉 Cliente ganhou corte grátis!');
                }
            }
        }

        query += ` WHERE id = $${paramCount} RETURNING *`;
        params.push(id);

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Agendamento não encontrado' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/agendamentos/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('DELETE FROM agendamentos WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Agendamento não encontrado' });
        }

        res.json({ 
            success: true, 
            message: 'Agendamento removido com sucesso!'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== ROTAS DE FILA ==========

app.get('/api/fila/:barbeariaId', async (req, res) => {
    const { barbeariaId } = req.params;

    try {
        const result = await pool.query(
            `SELECT COUNT(*) as total 
             FROM agendamentos 
             WHERE barbearia_id = $1 AND status IN ('aguardando', 'confirmado')`,
            [barbeariaId]
        );
        res.json({ fila: parseInt(result.rows[0].total) || 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== ROTA PARA ADICIONAR CORTE MANUAL (CPF) ==========
app.post('/api/clientes/adicionar-corte', async (req, res) => {
    const { cpf } = req.body;

    if (!cpf) {
        return res.status(400).json({ error: 'CPF é obrigatório' });
    }

    try {
        // Buscar cliente pelo CPF
        const cliente = await pool.query(
            'SELECT id, nome, pontos, cortes_gratis, total_cortes FROM clientes WHERE cpf = $1',
            [cpf]
        );

        if (cliente.rows.length === 0) {
            return res.status(404).json({ error: 'Cliente não encontrado' });
        }

        const clienteData = cliente.rows[0];
        
        // Atualizar pontos e total de cortes
        const novosPontos = clienteData.pontos + 1;
        const novoTotal = clienteData.total_cortes + 1;
        let novosCortesGratis = clienteData.cortes_gratis;

        // Verificar se ganhou corte grátis (a cada 4 cortes)
        if (novosPontos % 4 === 0) {
            novosCortesGratis += 1;
        }

        await pool.query(
            `UPDATE clientes 
             SET pontos = $1, total_cortes = $2, cortes_gratis = $3 
             WHERE id = $4`,
            [novosPontos, novoTotal, novosCortesGratis, clienteData.id]
        );

        // Buscar dados atualizados
        const clienteAtualizado = await pool.query(
            'SELECT id, nome, cpf, pontos, cortes_gratis, total_cortes FROM clientes WHERE id = $1',
            [clienteData.id]
        );

        res.json({
            success: true,
            cliente: clienteAtualizado.rows[0],
            message: 'Corte adicionado com sucesso!'
        });

    } catch (error) {
        console.error('❌ Erro ao adicionar corte:', error);
        res.status(500).json({ error: 'Erro ao adicionar corte: ' + error.message });
    }
});

// ========== ROTA PARA USAR CORTE GRÁTIS ==========
app.post('/api/clientes/usar-corte-gratis', async (req, res) => {
    const { cpf } = req.body;

    if (!cpf) {
        return res.status(400).json({ error: 'CPF é obrigatório' });
    }

    try {
        const cliente = await pool.query(
            'SELECT id, nome, cortes_gratis FROM clientes WHERE cpf = $1',
            [cpf]
        );

        if (cliente.rows.length === 0) {
            return res.status(404).json({ error: 'Cliente não encontrado' });
        }

        if (cliente.rows[0].cortes_gratis <= 0) {
            return res.status(400).json({ error: 'Cliente não tem cortes grátis disponíveis' });
        }

        const novosCortesGratis = cliente.rows[0].cortes_gratis - 1;

        await pool.query(
            `UPDATE clientes SET cortes_gratis = $1 WHERE id = $2`,
            [novosCortesGratis, cliente.rows[0].id]
        );

        res.json({
            success: true,
            message: 'Corte grátis utilizado com sucesso!',
            cortes_gratis_restantes: novosCortesGratis
        });

    } catch (error) {
        console.error('❌ Erro ao usar corte grátis:', error);
        res.status(500).json({ error: 'Erro ao usar corte grátis: ' + error.message });
    }
});

// ========== ROTA DE ESTOQUE ==========

app.get('/api/estoque/:barbeariaId', async (req, res) => {
    const { barbeariaId } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM estoque WHERE barbearia_id = $1 ORDER BY item',
            [barbeariaId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/estoque', async (req, res) => {
    const { barbeariaId, item, quantidade } = req.body;

    if (!barbeariaId || !item || quantidade === undefined) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO estoque (barbearia_id, item, quantidade) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (barbearia_id, item) 
             DO UPDATE SET quantidade = EXCLUDED.quantidade 
             RETURNING *`,
            [barbeariaId, item, quantidade]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== ROTAS DE PREÇOS ==========

app.get('/api/precos/:barbeariaId', async (req, res) => {
    const { barbeariaId } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM precos WHERE barbearia_id = $1',
            [barbeariaId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/precos', async (req, res) => {
    const { barbeariaId, servico, preco } = req.body;

    if (!barbeariaId || !servico || preco === undefined) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO precos (barbearia_id, servico, preco) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (barbearia_id, servico) 
             DO UPDATE SET preco = EXCLUDED.preco 
             RETURNING *`,
            [barbeariaId, servico, preco]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== ROTAS DE MERCADO PAGO ==========

app.post('/api/pagamento/checkout', async (req, res) => {
    const { 
        clienteId, 
        clienteNome, 
        clienteEmail, 
        servico, 
        valor, 
        descricao, 
        agendamentoId 
    } = req.body;

    console.log('💳 INICIANDO PAGAMENTO:');
    console.log('  Cliente ID:', clienteId);
    console.log('  Cliente:', clienteNome, clienteEmail);
    console.log('  Serviço:', servico);
    console.log('  Valor:', valor);
    console.log('  Agendamento:', agendamentoId);

    if (!clienteId) {
        return res.status(400).json({ 
            success: false, 
            error: 'ID do cliente é obrigatório' 
        });
    }

    const clienteIdInt = parseInt(clienteId);
    if (isNaN(clienteIdInt) || clienteIdInt <= 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'ID do cliente inválido' 
        });
    }

    if (!clienteEmail) {
        return res.status(400).json({ 
            success: false, 
            error: 'Email do cliente é obrigatório' 
        });
    }
    if (!valor || isNaN(parseFloat(valor)) || parseFloat(valor) <= 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'Valor inválido' 
        });
    }
    if (!descricao) {
        return res.status(400).json({ 
            success: false, 
            error: 'Descrição é obrigatória' 
        });
    }

    try {
        const cliente = await pool.query(
            'SELECT * FROM clientes WHERE id = $1',
            [clienteIdInt]
        );
        
        if (cliente.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Cliente não encontrado' 
            });
        }

        const clienteData = cliente.rows[0];
        const valorNumerico = parseFloat(valor);

        let agendamentoIdInt = null;
        if (agendamentoId && agendamentoId !== 'null' && agendamentoId !== 'undefined' && agendamentoId !== '') {
            agendamentoIdInt = parseInt(agendamentoId);
            if (isNaN(agendamentoIdInt) || agendamentoIdInt <= 0) {
                agendamentoIdInt = null;
            }
        }

        let telefoneNumero = 999999999;
        let ddd = '11';

        if (clienteData.telefone) {
            const numeros = clienteData.telefone.replace(/\D/g, '');
            if (numeros.length >= 10) {
                ddd = numeros.slice(0, 2);
                telefoneNumero = parseInt(numeros.slice(2)) || 999999999;
            } else if (numeros.length >= 8) {
                ddd = '11';
                telefoneNumero = parseInt(numeros) || 999999999;
            } else {
                ddd = '11';
                telefoneNumero = 999999999;
            }
        } else {
            ddd = '11';
            telefoneNumero = 999999999;
        }

        if (telefoneNumero < 10000000 || telefoneNumero > 999999999) {
            ddd = '11';
            telefoneNumero = 999999999;
        }

        const baseUrl = process.env.BASE_URL || 'https://barbeonline.vercel.app';

        const payer = {
            name: (clienteData.nome || clienteNome || 'Cliente').substring(0, 50),
            email: (clienteEmail || clienteData.email || 'cliente@email.com').substring(0, 50),
            phone: {
                area_code: ddd,
                number: telefoneNumero
            }
        };

        const preference = {
            items: [{
                id: agendamentoIdInt ? agendamentoIdInt.toString() : Date.now().toString(),
                title: descricao,
                description: servico || descricao,
                unit_price: valorNumerico,
                quantity: 1,
                currency_id: 'BRL',
                picture_url: 'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=200&h=200&fit=crop'
            }],
            payer: payer,
            back_urls: {
                success: `${baseUrl}/sucesso.html`,
                failure: `${baseUrl}/falha.html`,
                pending: `${baseUrl}/pendente.html`
            },
            payment_methods: {
                installments: 1,
                excluded_payment_methods: [],
                excluded_payment_types: []
            },
            notification_url: `${baseUrl}/api/pagamento/webhook`,
            external_reference: agendamentoIdInt ? agendamentoIdInt.toString() : Date.now().toString(),
            statement_descriptor: 'BARBEONLINE'
        };

        console.log('📤 Enviando para Mercado Pago...');
        const response = await mercadopago.preferences.create(preference);
        console.log('✅ Preferência criada:', response.body.id);

        await pool.query(
            `INSERT INTO pagamentos 
             (cliente_id, agendamento_id, mp_preference_id, valor, status) 
             VALUES ($1, $2, $3, $4, $5)`,
            [
                clienteIdInt, 
                agendamentoIdInt, 
                response.body.id, 
                valorNumerico, 
                'pendente'
            ]
        );

        if (agendamentoIdInt) {
            await pool.query(
                'UPDATE agendamentos SET pagamento_id = $1 WHERE id = $2',
                [response.body.id, agendamentoIdInt]
            );
        }

        res.json({
            success: true,
            preference_id: response.body.id,
            init_point: response.body.init_point,
            sandbox_init_point: response.body.sandbox_init_point,
            message: 'Pagamento gerado com sucesso!'
        });

    } catch (error) {
        console.error('❌ ERRO no pagamento:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erro ao gerar pagamento: ' + error.message 
        });
    }
});

app.post('/api/pagamento/webhook', async (req, res) => {
    try {
        const { id, topic } = req.body;
        console.log('📨 Webhook recebido:', { id, topic });

        if (topic === 'payment') {
            const payment = await mercadopago.payment.findById(id);
            console.log('💳 Status do pagamento:', payment.body.status);
            
            if (payment.body && payment.body.status === 'approved') {
                const preferenceId = payment.body.preference_id;
                const externalReference = payment.body.external_reference;

                await pool.query(
                    `UPDATE pagamentos 
                     SET status = 'aprovado', 
                         mp_payment_id = $1,
                         metodo = $2
                     WHERE mp_preference_id = $3`,
                    [id, payment.body.payment_type_id, preferenceId]
                );

                if (externalReference) {
                    await pool.query(
                        `UPDATE agendamentos 
                         SET status = 'confirmado', forma_pagamento = 'cartao'
                         WHERE id = $1`,
                        [parseInt(externalReference)]
                    );
                    console.log(`✅ Agendamento ${externalReference} confirmado!`);
                }

                console.log(`✅ Pagamento ${id} aprovado!`);
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        res.sendStatus(500);
    }
});

// ========== ROTAS DE PÁGINAS ==========

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/cliente', (req, res) => {
    res.sendFile(__dirname + '/public/cliente.html');
});

app.get('/admin', (req, res) => {
    res.sendFile(__dirname + '/public/admin.html');
});

app.get('/sucesso.html', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><title>Pagamento Aprovado</title></head>
        <body style="background:#0b0a0a;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
            <div style="text-align:center;">
                <h1 style="color:#27ae60;">✅ Pagamento Aprovado!</h1>
                <p>Seu agendamento foi confirmado.</p>
                <a href="/cliente" style="color:#f5b041;">Voltar para área do cliente</a>
            </div>
        </body>
        </html>
    `);
});

app.get('/falha.html', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><title>Pagamento Falhou</title></head>
        <body style="background:#0b0a0a;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
            <div style="text-align:center;">
                <h1 style="color:#e74c3c;">❌ Pagamento Falhou</h1>
                <p>Tente novamente ou escolha outra forma de pagamento.</p>
                <a href="/cliente" style="color:#f5b041;">Voltar para área do cliente</a>
            </div>
        </body>
        </html>
    `);
});

app.get('/pendente.html', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><title>Pagamento Pendente</title></head>
        <body style="background:#0b0a0a;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
            <div style="text-align:center;">
                <h1 style="color:#f39c12;">⏳ Pagamento Pendente</h1>
                <p>Seu pagamento está sendo processado.</p>
                <a href="/cliente" style="color:#f5b041;">Voltar para área do cliente</a>
            </div>
        </body>
        </html>
    `);
});

// ========== INICIAR SERVIDOR ==========
app.listen(port, async () => {
    console.log(`🚀 Servidor rodando na porta ${port}`);
    console.log(`📱 Acesse: http://localhost:${port}`);
    console.log(`👤 Área do cliente: http://localhost:${port}/cliente`);
    console.log(`🔧 Painel Admin: http://localhost:${port}/admin`);
    console.log(`💰 Pagamentos em PRODUÇÃO com Mercado Pago!`);
    await initDatabase();
    console.log('✅ Sistema pronto!');
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Erro não tratado:', err);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Exceção não capturada:', err);
});