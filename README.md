# Mesa Colisão RPG

Mesa online para o **Colisão RPG**. O Mestre cria uma sala, manda o código, os players entram, fazem a ficha e jogam juntos em tempo real.

- **Contas com login.** Cada pessoa cria usuário e senha. A sessão fica salva por 30 dias.
- **Salas com código.** O Mestre cria a sala e manda o código de 6 letras ou o link de convite.
- **Fichas salvas.** Cada player faz a ficha completa (identificação, PV, Couraça, Movimento, Tormento, atributos, expertises, chamado, estados, Vontade, Medo, talentos, rituais, habilidades). O Mestre vê e edita todas.
- **PDF.** Qualquer ficha pode ser baixada no PDF oficial já preenchido.
- **Combate.** Iniciativa por Técnica, turnos, rodadas, dano e cura, Couraça 8 (+2 ao desviar), Medo com aviso de Sobrecarga e Pânico. Criaturas podem ter os números escondidos dos players.
- **Dados.** Testes seguem as regras do livro (dado do atributo, dados do talento, tenacidade, vantagem e desvantagem de 1d4) e avisam o Sucesso Extremo. Todas as rolagens são feitas no servidor. O Mestre pode rolar escondido.
- **Roteiro do Mestre.** Cenas, pistas com teste e NPCs. O Mestre revela pistas e coloca NPCs em destaque na tela de todos.
- **Trilha e falas.** Sons para todo mundo ao mesmo tempo. O Mestre também pode **escrever uma fala do monstro na hora** (voz grave do navegador com rosnado por baixo e legenda na tela) ou **gravar a própria voz** pelo microfone, que cada player ouve com efeito monstruoso.

Não usa nenhuma biblioteca externa no servidor: é Node puro. Os dados ficam no **Supabase** (ou num arquivo local quando você roda no seu PC).

---

## Rodar no seu computador

Precisa do Node 20 ou mais novo.

```bash
npm start
```

Abra http://localhost:3000. Sem configurar o Supabase, os dados ficam na pasta `data/`.

---

## Colocar no ar (Render grátis + Supabase grátis)

O plano grátis do Render apaga os arquivos sempre que o servidor reinicia, e ele reinicia depois de 15 minutos sem uso. Por isso os dados ficam no Supabase.

### 1. Supabase

1. Crie um projeto em https://supabase.com.
2. Abra **SQL Editor**, cole o conteúdo de `supabase.sql` e clique em **Run**.
3. Em **Project Settings > API**, copie:
   - a **Project URL** (algo como `https://abcd.supabase.co`);
   - a chave **service_role** (é secreta: nunca coloque no código nem mande para ninguém).

### 2. Render

1. No Render, clique em **New > Blueprint** e escolha este repositório. Ele lê o `render.yaml` sozinho.
2. Quando pedir as variáveis, preencha:
   - `SUPABASE_URL` = a Project URL
   - `SUPABASE_SERVICE_KEY` = a chave service_role
3. Espere o deploy terminar e abra o endereço que o Render der.

Se preferir criar na mão: **New > Web Service**, escolha o repositório, Runtime **Node**, Build Command `true`, Start Command `node server.js`, e adicione as duas variáveis acima em **Environment**.

### Coisas do plano grátis

- **Primeira abertura lenta.** Depois de 15 minutos sem ninguém, o Render desliga o servidor. A primeira pessoa a abrir espera uns 50 segundos. Durante a sessão ele fica ligado.
- **Supabase pausa sem uso.** Projetos grátis pausam depois de uma semana parados. É só entrar no painel do Supabase e clicar em **Restore**.
- **Falas gravadas** ficam só na memória por 1 hora. Fichas, salas e roteiro ficam salvos no Supabase.

---

## Como jogar

1. O Mestre cria uma conta, depois **Criar sala** (marque "Vale das Cinzas" para começar com a sessão pronta).
2. Em **Jogadores** ou no botão do código, ele copia o convite e manda no grupo.
3. Cada player abre o link, cria a conta e faz a ficha em **Minha ficha**.
4. No começo da sessão, todo mundo toca em **Ativar som**. Sem isso o navegador bloqueia o áudio.
5. A gravação de voz pede permissão do microfone. Funciona melhor no Chrome ou Edge do computador.

## Arquivos

| Arquivo | O que é |
| --- | --- |
| `server.js` | Servidor: contas, salas, fichas, combate, dados, tempo real (Server-Sent Events) e o Supabase |
| `public/index.html` | As três telas: login, salas e mesa |
| `public/app.js` | Todo o app do navegador |
| `public/app.css` | O visual |
| `public/ficha.pdf` | A ficha oficial com campos, usada para gerar o PDF |
| `public/sons/` | Vozes do monstro, sino, ambiente, batimento e rosnado |
| `seed-vale-das-cinzas.json` | Roteiro, falas e a criatura da sessão Vale das Cinzas |
| `supabase.sql` | Cria a tabela no Supabase |
| `render.yaml` | Configuração do Render |
