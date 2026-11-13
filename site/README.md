# Guia do ColorSense

Página com o passo a passo de instalação e a explicação de cada função do app,
publicada em https://colorsense-guia.vercel.app. É um único `index.html`, sem
etapa de build.

## Publicar uma alteração

Não há deploy automático: um commit nesta pasta **não** atualiza o site.
Depois de alterar o `index.html`, publique de dentro desta pasta:

    npx vercel --prod

É preciso ter acesso ao projeto `colorsense-guia` na Vercel.

Os botões de download apontam para `releases/latest/download/` deste
repositório, então continuam certos a cada versão nova — desde que a release
seja publicada com os nomes de arquivo sem versão (veja "Como lançar uma
versão" no README principal).

O `vercel.json` também cria os endereços curtos `/baixar` e `/portatil`, que
redirecionam para os mesmos arquivos da última release. Eles existem para o
endereço alternativo caber numa linha só, inclusive no celular.

O endereço do formulário da pesquisa aparece só no `vercel.json`, no
redirecionamento `/pesquisa`. Todos os botões do site usam `/pesquisa`: se o
formulário for recriado, basta trocar o endereço ali e publicar.
