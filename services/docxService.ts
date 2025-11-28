import { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, Footer, PageBreak } from "docx";
import { Question } from "../types";

export const exportToDocx = async (questions: Question[], title: string) => {
  const docChildren: any[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: title.toUpperCase(),
          bold: true,
          size: 32, // 16pt (Word sizes are in half-points)
          font: "Times New Roman",
        }),
      ],
      spacing: { after: 400 },
    }),
  ];

  // 1. Add Questions
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    
    // Main Question Text (e.g. "Câu 1: Giải phương trình:")
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Câu ${i + 1} (${q.difficulty}): `,
            bold: true,
            size: 26, // 13pt
            font: "Times New Roman",
          }),
          new TextRun({
            text: q.content, 
            size: 26, // 13pt
            font: "Times New Roman",
          }),
        ],
        spacing: { before: 200, after: 100 },
      })
    );

    // Main Image (BELOW main text)
    if (q.imageData) {
      const base64Data = q.imageData.split(',')[1];
      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: base64Data,
              transformation: {
                width: 300,
                height: 300,
              },
              type: "png",
            }),
          ],
          spacing: { after: 200 },
        })
      );
    }

    // Sub-questions (a, b, c...)
    if (q.parts && q.parts.length > 0) {
        for (const part of q.parts) {
            // Part text (indented)
            docChildren.push(
                new Paragraph({
                    indent: { left: 720 }, // ~0.5 inch indentation
                    children: [
                        new TextRun({
                            text: `${part.label} `,
                            bold: true,
                            size: 26,
                            font: "Times New Roman",
                        }),
                        new TextRun({
                            text: part.content,
                            size: 26,
                            font: "Times New Roman",
                        })
                    ],
                    spacing: { after: 100 }
                })
            );

            // Part Image (Indented and centered relative to indent)
            if (part.imageData) {
                const base64Data = part.imageData.split(',')[1];
                docChildren.push(
                    new Paragraph({
                        alignment: AlignmentType.LEFT,
                        indent: { left: 1440 }, // More indent for image
                        children: [
                            new ImageRun({
                                data: base64Data,
                                transformation: {
                                    width: 200,
                                    height: 200,
                                },
                                type: "png",
                            }),
                        ],
                        spacing: { after: 100 },
                    })
                );
            }
        }
    }
  }

  // 2. Add Page Break
  docChildren.push(new Paragraph({
    children: [new PageBreak()],
  }));

  // 3. Add Answer Key Title
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: "HƯỚNG DẪN GIẢI & ĐÁP ÁN",
          bold: true,
          size: 32, // 16pt
          font: "Times New Roman",
        }),
      ],
      spacing: { before: 200, after: 400 },
    })
  );

  // 4. Add Solutions
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    
    // Main Solution Header
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Câu ${i + 1}: `,
            bold: true,
            size: 26, // 13pt
            font: "Times New Roman",
          }),
          new TextRun({
            text: q.solution || (q.parts ? "" : "(Không có lời giải chi tiết)"),
            size: 26, // 13pt
            font: "Times New Roman",
          }),
        ],
        spacing: { before: 100, after: 50 },
      })
    );

    // Sub-question Solutions
    if (q.parts && q.parts.length > 0) {
        for (const part of q.parts) {
            docChildren.push(
                new Paragraph({
                    indent: { left: 720 },
                    children: [
                        new TextRun({
                            text: `${part.label} `,
                            bold: true,
                            size: 26,
                            font: "Times New Roman",
                        }),
                        new TextRun({
                            text: part.solution || "(Chưa cập nhật)",
                            size: 26,
                            font: "Times New Roman",
                        })
                    ]
                })
            );
        }
    }
  }

  // Define Footer for Copyright
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
             text: "Create by Hoà Hiệp AI - 0983.676.470",
             italics: false,
             size: 22, // 11pt
             color: "808080", // Gray
             font: "Times New Roman",
          })
        ]
      })
    ]
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: docChildren,
        footers: {
            default: footer,
        }
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return blob;
};