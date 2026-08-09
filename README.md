# DeskFlow

Portada y panel de progreso de **LearnFlow**, una plataforma para aprender
idiomas. Es el punto de entrada: presenta la propuesta de valor, hace la
autoevaluación de nivel y reúne el progreso de las otras tres apps.

| App | Qué hace | URL |
|---|---|---|
| **DeskFlow** | Portada y progreso | [/deskflow/](https://genilsuarez.github.io/deskflow/) |
| FluentFlow | Curso estructurado, A1–C2 | [/fluentflow/](https://genilsuarez.github.io/fluentflow/) |
| HubFlow | Ejercicios interactivos | [/hubflow/](https://genilsuarez.github.io/hubflow/) |
| LyricFlow | Práctica con música | [/lyricflow/](https://genilsuarez.github.io/lyricflow/) |

Las cuatro comparten origen en producción, así que el tema y el progreso se
propagan entre ellas por `localStorage` sin puentes.

## Desarrollo local

Servir desde el gateway compartido en el puerto **3000** (`learnctl start`), no
con un servidor suelto — el origen común es lo que hace que se compartan tema y
progreso.

## Licencia

| Qué | Licencia |
|---|---|
| Código fuente | [Apache-2.0](LICENSE) |
| Contenido educativo | [CC BY-SA 4.0](LICENSE-CONTENT.md) |

Puedes reusar y adaptar ambos, incluso comercialmente, pero debes **dar crédito**
a Genil Alejandro Suarez Perez y conservar el archivo [NOTICE](NOTICE). Los
nombres y logos de LearnFlow no están cubiertos por estas licencias.
